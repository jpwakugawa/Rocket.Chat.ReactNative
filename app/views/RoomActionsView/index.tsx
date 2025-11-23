/* eslint-disable complexity */
import { Q } from '@nozbe/watermelondb';
import { type NativeStackNavigationOptions, type NativeStackNavigationProp } from '@react-navigation/native-stack';
import isEmpty from 'lodash/isEmpty';
import React from 'react';
import { Share } from 'react-native';
import { connect } from 'react-redux';
import { type Observable, type Subscription } from 'rxjs';
import { type CompositeNavigationProp } from '@react-navigation/native';

import { leaveRoom } from '../../actions/room';
import * as HeaderButton from '../../containers/Header/components/HeaderButton';
import * as List from '../../containers/List';
import SafeAreaView from '../../containers/SafeAreaView';
import {
	type IApplicationState,
	type IBaseScreen,
	type IUser,
	SubscriptionType,
	type TSubscriptionModel
} from '../../definitions';
import { withDimensions } from '../../dimensions';
import I18n from '../../i18n';
import database from '../../lib/database';
import protectedFunction from '../../lib/methods/helpers/protectedFunction';
import { getUserSelector } from '../../selectors/login';
import { type ChatsStackParamList } from '../../stacks/types';
import { withTheme } from '../../theme';
import { showConfirmationAlert, showErrorAlert } from '../../lib/methods/helpers/info';
import log, { events, logEvent } from '../../lib/methods/helpers/log';
import { ERoomType } from '../../definitions/ERoomType';
import { getPermalinkChannel } from '../../lib/methods/getPermalinks';
import {
	canAutoTranslate as canAutoTranslateMethod,
	getRoomTitle,
	getUidDirectMessage,
	hasPermission,
	isGroupChat,
	compareServerVersion,
	isTeamRoom
} from '../../lib/methods/helpers';
import {
	getUserInfo,
	toggleBlockUser,
	getRoomCounters,
	getChannelInfo,
	teamListRoomsOfUser,
	convertTeamToChannel,
	addRoomsToTeam,
	convertChannelToTeam,
	onHoldLivechat,
	returnLivechat
} from '../../lib/services/restApi';
import { getSubscriptionByRoomId } from '../../lib/database/services/Subscription';
import { type IActionSheetProvider, withActionSheet } from '../../containers/ActionSheet';
import { type MasterDetailInsideStackParamList } from '../../stacks/MasterDetailStack/types';
import CallSection from './components/CallSection';
import { type TNavigation } from '../../stacks/stackType';
import * as EncryptionUtils from '../../lib/encryption/utils';
import Navigation from '../../lib/navigation/appNavigation';
import RoomInfoSection from './components/RoomInfoSection';
import E2EEncryptionSection from './components/E2EEncryptionSection';

type StackType = ChatsStackParamList & TNavigation;

interface IOnPressTouch {
	<T extends keyof StackType>(item: { route?: T; params?: StackType[T]; event?: Function }): void;
}

interface IRoomActionsViewProps extends IActionSheetProvider, IBaseScreen<StackType, 'RoomActionsView'> {
	userId: string;
	jitsiEnabled: boolean;
	jitsiEnableTeams: boolean;
	jitsiEnableChannels: boolean;
	encryptionEnabled: boolean;
	serverVersion: string | null;
	editRoomPermission?: string[];
	toggleRoomE2EEncryptionPermission?: string[];
	viewBroadcastMemberListPermission?: string[];
	createTeamPermission?: string[];
	addTeamChannelPermission?: string[];
	moveRoomToTeamPermission?: string[];
	convertTeamPermission?: string[];
	viewCannedResponsesPermission?: string[];
	livechatAllowManualOnHold?: boolean;
	livechatRequestComment?: boolean;
	navigation: CompositeNavigationProp<
		NativeStackNavigationProp<ChatsStackParamList, 'RoomActionsView'>,
		NativeStackNavigationProp<MasterDetailInsideStackParamList & TNavigation>
	>;
	videoConf_Enable_DMs: boolean;
	videoConf_Enable_Channels: boolean;
	videoConf_Enable_Groups: boolean;
	videoConf_Enable_Teams: boolean;
}

interface IRoomActionsViewState {
	room: TSubscriptionModel;
	membersCount?: number;
	member: Partial<IUser>;
	joined: boolean;
	canViewMembers: boolean;
	canAutoTranslate: boolean;
	canEdit: boolean;
	canToggleEncryption: boolean;
	canCreateTeam: boolean;
	canAddChannelToTeam: boolean;
	canConvertTeam: boolean;
	hasE2EEWarning: boolean;
	loading: boolean;
}

class RoomActionsView extends React.Component<IRoomActionsViewProps, IRoomActionsViewState> {
	private mounted: boolean;
	private rid: string;
	private t: string;
	private joined: boolean;
	private omnichannelPermissions?: {
		canForwardGuest: boolean;
		canReturnQueue: boolean;
		canViewCannedResponse: boolean;
		canPlaceLivechatOnHold: boolean;
	};
	private roomObservable?: Observable<TSubscriptionModel>;
	private subscription?: Subscription;
	private prevUsersCount?: number;

	static navigationOptions = ({
		navigation,
		isMasterDetail
	}: Pick<IRoomActionsViewProps, 'navigation' | 'isMasterDetail'>): NativeStackNavigationOptions => {
		const options: NativeStackNavigationOptions = {
			title: I18n.t('Actions')
		};
		if (isMasterDetail) {
			options.headerLeft = () => <HeaderButton.CloseModal navigation={navigation} testID='room-actions-view-close' />;
		}
		return options;
	};

	constructor(props: IRoomActionsViewProps) {
		super(props);
		this.mounted = false;
		const room = props.route.params?.room;
		const member = props.route.params?.member;
		this.rid = props.route.params?.rid;
		this.t = props.route.params?.t;
		this.joined = props.route.params?.joined;
		this.omnichannelPermissions = props.route.params?.omnichannelPermissions;
		this.state = {
			room: room || { rid: this.rid, t: this.t },
			membersCount: 0,
			member: member || {},
			joined: !!room,
			canViewMembers: false,
			canAutoTranslate: false,
			canEdit: false,
			canToggleEncryption: false,
			canCreateTeam: false,
			canAddChannelToTeam: false,
			canConvertTeam: false,
			hasE2EEWarning: false,
			loading: false
		};
		this.prevUsersCount = this.state.room.usersCount;

		if (room && room.observe && room.rid) {
			const { encryptionEnabled } = this.props;
			this.roomObservable = room.observe();
			this.subscription = this.roomObservable.subscribe(async changes => {
				if (this.mounted) {
					const hasE2EEWarning = EncryptionUtils.hasE2EEWarning({
						encryptionEnabled,
						E2EKey: room.E2EKey,
						roomEncrypted: room.encrypted
					});
					this.setState({ room: changes, hasE2EEWarning });
				} else {
					// @ts-ignore
					this.state.room = changes;
				}

				// If the previous users count changes, we will update it and the members count to the value from the room counter.
				if (this.prevUsersCount !== changes.usersCount) {
					const counters = await getRoomCounters(room.rid, room.t as any);
					if (counters.success) {
						if (this.mounted) {
							this.setState({ membersCount: counters.members });
						} else {
							// @ts-ignore
							this.state.membersCount = counters.members;
						}
						this.updateUsersCount(counters.members);
						this.prevUsersCount = changes.usersCount;
					}
				}
			});
		}
	}

	async componentDidMount() {
		this.mounted = true;
		const { room, member } = this.state;
		const { encryptionEnabled } = this.props;
		if (room.rid) {
			if (!room.id) {
				if (room.t === SubscriptionType.OMNICHANNEL) {
					if (!this.isOmnichannelPreview) {
						const result = await getSubscriptionByRoomId(room.rid);
						if (result) {
							this.setState({ room: result });
						}
					}
				} else {
					try {
						const result = await getChannelInfo(room.rid);
						if (result.success) {
							// @ts-ignore
							this.setState({ room: { ...result.channel, rid: result.channel._id } });
						}
					} catch (e) {
						log(e);
					}
				}
			}

			if (room && (await this.canViewMembers())) {
				try {
					const counters = await getRoomCounters(room.rid, room.t as any);
					if (counters.success) {
						await this.updateUsersCount(counters.members);
						this.setState({ joined: counters.joined, membersCount: counters.members });
					}
				} catch (e) {
					log(e);
				}
			} else if (room.t === 'd' && isEmpty(member)) {
				this.updateRoomMember();
			}

			const canAutoTranslate = canAutoTranslateMethod();
			const canEdit = await this.canEdit();
			const canToggleEncryption = await this.canToggleEncryption();
			const canViewMembers = await this.canViewMembers();
			const canCreateTeam = await this.canCreateTeam();
			const canAddChannelToTeam = await this.hasMoveToTeamPermission(room.rid);
			const canConvertTeam = await this.canConvertTeam();
			const hasE2EEWarning = EncryptionUtils.hasE2EEWarning({
				encryptionEnabled,
				E2EKey: room.E2EKey,
				roomEncrypted: room.encrypted
			});

			this.setState({
				canAutoTranslate,
				canEdit,
				canToggleEncryption,
				canViewMembers,
				canCreateTeam,
				canAddChannelToTeam,
				canConvertTeam,
				hasE2EEWarning
			});
		}
	}

	componentWillUnmount() {
		if (this.subscription && this.subscription.unsubscribe) {
			this.subscription.unsubscribe();
		}
	}

	get isOmnichannelPreview() {
		const { room } = this.state;
		return room.t === 'l' && room.status === 'queued' && !this.joined;
	}

	updateUsersCount = async (members: number) => {
		const { room } = this.state;
		if (members === room.usersCount) return;
		try {
			const db = database.active;
			await db.write(async () => {
				await room.update(
					protectedFunction((r: TSubscriptionModel) => {
						r.usersCount = members;
					})
				);
			});
		} catch {
			//
		}
	};

	onPressTouchable: IOnPressTouch = (item: {
		route?: keyof StackType;
		params?: StackType[keyof StackType];
		event?: Function;
	}) => {
		const { route, event, params } = item;
		if (route) {
			/**
			 * TODO: params can vary too much and ts is going to be happy
			 * Instead of playing with this, we should think on a better `logEvent` function
			 */
			// @ts-ignore
			logEvent(events[`RA_GO_${route.replace('View', '').toUpperCase()}${params.name ? params.name.toUpperCase() : ''}`]);
			const { navigation } = this.props;
			// @ts-ignore
			navigation.navigate(route, params);
		}
		if (event) {
			return event();
		}
	};

	canEdit = async () => {
		const { room } = this.state;
		const { editRoomPermission } = this.props;
		const { rid } = room;
		const permissions = await hasPermission([editRoomPermission], rid);

		const canEdit = permissions[0];
		return canEdit;
	};

	canCreateTeam = async () => {
		const { room } = this.state;
		const { createTeamPermission } = this.props;
		const { rid } = room;
		const permissions = await hasPermission([createTeamPermission], rid);

		const canCreateTeam = permissions[0];
		return canCreateTeam;
	};

	hasMoveToTeamPermission = async (rid: string) => {
		const { addTeamChannelPermission, moveRoomToTeamPermission, serverVersion } = this.props;
		if (compareServerVersion(serverVersion, 'greaterThanOrEqualTo', '7.0.0')) {
			const result = await hasPermission([moveRoomToTeamPermission], rid);
			return result[0];
		}
		const result = await hasPermission([addTeamChannelPermission], rid);
		return result[0];
	};

	canConvertTeam = async () => {
		const { room } = this.state;
		const { convertTeamPermission } = this.props;
		const { rid } = room;
		const permissions = await hasPermission([convertTeamPermission], rid);

		const canConvertTeam = permissions[0];
		return canConvertTeam;
	};

	canToggleEncryption = async () => {
		const { room } = this.state;
		const { toggleRoomE2EEncryptionPermission } = this.props;
		const { rid } = room;
		const permissions = await hasPermission([toggleRoomE2EEncryptionPermission], rid);

		const canToggleEncryption = permissions[0];
		return canToggleEncryption;
	};

	canViewMembers = async () => {
		const { room } = this.state;
		const { viewBroadcastMemberListPermission } = this.props;
		const { rid, t, broadcast } = room;
		if (broadcast) {
			const permissions = await hasPermission([viewBroadcastMemberListPermission], rid);
			if (!permissions[0]) {
				return false;
			}
		}

		// This method is executed only in componentDidMount and returns a value
		// We save the state to read in render
		const result = t === 'c' || t === 'p' || t === 'd';
		return result;
	};

	updateRoomMember = async () => {
		const { room } = this.state;

		try {
			if (!isGroupChat(room)) {
				const roomUserId = getUidDirectMessage(room);
				const result = await getUserInfo(roomUserId);
				if (result.success) {
					this.setState({ member: result.user as any });
				}
			}
		} catch (e) {
			log(e);
			this.setState({ member: {} });
		}
	};

	handleShare = () => {
		logEvent(events.RA_SHARE);
		const { room } = this.state;
		const permalink = getPermalinkChannel(room);
		if (!permalink) {
			return;
		}
		Share.share({
			message: permalink
		});
	};

	handleConvertTeamToChannel = async (selected: string[]) => {
		logEvent(events.RA_CONVERT_TEAM_TO_CHANNEL);
		try {
			const { room } = this.state;

			if (!room.teamId) {
				return;
			}
			const result = await convertTeamToChannel({ teamId: room.teamId, selected });

			if (result.success) {
				Navigation.resetTo();
			}
		} catch (e) {
			logEvent(events.RA_CONVERT_TEAM_TO_CHANNEL_F);
			log(e);
		}
	};

	convertTeamToChannelConfirmation = (selected: string[] = []) => {
		showConfirmationAlert({
			title: I18n.t('Confirmation'),
			message: I18n.t('You_are_converting_the_team'),
			confirmationText: I18n.t('Convert'),
			onPress: () => this.handleConvertTeamToChannel(selected)
		});
	};

	handleConvertToTeam = async () => {
		logEvent(events.RA_CONVERT_TO_TEAM);
		try {
			const { room } = this.state;
			const result = await convertChannelToTeam({ rid: room.rid, name: room.name, type: room.t as any });

			if (result.success) {
				Navigation.resetTo();
			}
		} catch (e) {
			logEvent(events.RA_CONVERT_TO_TEAM_F);
			log(e);
		}
	};

	handleMoveToTeam = async (selected: string[]) => {
		logEvent(events.RA_MOVE_TO_TEAM);
		try {
			const { room } = this.state;
			const result = await addRoomsToTeam({ teamId: selected?.[0], rooms: [room.rid] });
			if (result.success) {
				Navigation.resetTo();
			}
		} catch (e) {
			logEvent(events.RA_MOVE_TO_TEAM_F);
			log(e);
			showErrorAlert(I18n.t('There_was_an_error_while_action', { action: I18n.t('moving_channel_to_team') }));
		}
	};

	searchTeam = async (onChangeText: string) => {
		logEvent(events.RA_SEARCH_TEAM);
		try {
			const QUERY_SIZE = 50;
			const db = database.active;
			const teams = await db
				.get('subscriptions')
				.query(
					Q.where('team_main', true),
					Q.where('name', Q.like(`%${onChangeText}%`)),
					Q.take(QUERY_SIZE),
					Q.sortBy('room_updated_at', Q.desc)
				)
				.fetch();

			const asyncFilter = async (teamArray: TSubscriptionModel[]) => {
				const results = await Promise.all(
					teamArray.map(async team => {
						const result = await this.hasMoveToTeamPermission(team.rid);
						return result;
					})
				);

				return teamArray.filter((_v, index) => results[index]);
			};
			const teamsFiltered = await asyncFilter(teams);
			return teamsFiltered;
		} catch (e) {
			log(e);
		}
	};

	render() {
		const { room, membersCount, canViewMembers, joined, canAutoTranslate, hasE2EEWarning } = this.state;
		const { isMasterDetail, navigation } = this.props;
		const { rid, t, prid, teamId } = room;
		const isGroupChatHandler = isGroupChat(room);

		return (
			<SafeAreaView testID='room-actions-view'>
				<List.Container testID='room-actions-scrollview'>
					<RoomInfoSection
						room={room}
						membersCount={membersCount}
						canViewMembers={canViewMembers}
						joined={joined}
						navigation={navigation}
						isGroupChatHandler={isGroupChatHandler}
					/>
					<CallSection rid={rid} disabled={hasE2EEWarning} />
					<E2EEncryptionSection room={room} canToggleEncryption={this.state.canToggleEncryption} canEdit={this.state.canEdit} />
					<List.Section>
						<List.Separator />

						{(['c', 'p'].includes(t) && canViewMembers) || isGroupChatHandler ? (
							<>
								<List.Item
									title='Members'
									subtitle={membersCount && membersCount > 0 ? `${membersCount} ${I18n.t('members')}` : undefined}
									onPress={() => this.onPressTouchable({ route: 'RoomMembersView', params: { rid, room, joined: this.joined } })}
									testID='room-actions-members'
									left={() => <List.Icon name='team' />}
									showActionIndicator
									translateSubtitle={false}
								/>
								<List.Separator />
							</>
						) : null}

						{['c', 'p', 'd'].includes(t) && !prid ? (
							<>
								<List.Item
									title='Discussions'
									onPress={() =>
										this.onPressTouchable({
											route: 'DiscussionsView',
											params: {
												rid,
												t
											}
										})
									}
									testID='room-actions-discussions'
									left={() => <List.Icon name='discussions' />}
									showActionIndicator
									disabled={hasE2EEWarning}
								/>
								<List.Separator />
							</>
						) : null}
						{teamId && isTeamRoom({ teamId, joined }) ? (
							<>
								<List.Item
									title='Channels'
									onPress={() => {
										logEvent(events.ROOM_GO_TEAM_CHANNELS);
										if (isMasterDetail) {
											// @ts-ignore TODO: find a way to make this work - OLD Diego :)
											navigation.navigate('ModalStackNavigator', {
												screen: 'TeamChannelsView',
												params: { teamId, joined }
											});
										} else {
											navigation.navigate('TeamChannelsView', {
												teamId,
												joined
											});
										}
									}}
									testID='room-actions-teams'
									left={() => <List.Icon name='channel-public' />}
									showActionIndicator
									disabled={hasE2EEWarning}
								/>
								<List.Separator />
							</>
						) : null}
						{['l'].includes(t) && !this.isOmnichannelPreview && this.omnichannelPermissions?.canViewCannedResponse ? (
							<>
								<List.Item
									title='Canned_Responses'
									onPress={() => this.onPressTouchable({ route: 'CannedResponsesListView', params: { rid } })}
									left={() => <List.Icon name='canned-response' />}
									showActionIndicator
								/>
								<List.Separator />
							</>
						) : null}

						{['c', 'p', 'd'].includes(t) ? (
							<>
								<List.Item
									title='Files'
									onPress={() =>
										this.onPressTouchable({
											route: 'MessagesView',
											params: { rid, t, name: 'Files' }
										})
									}
									testID='room-actions-files'
									left={() => <List.Icon name='attach' />}
									showActionIndicator
									disabled={hasE2EEWarning}
								/>
								<List.Separator />
							</>
						) : null}

						{['c', 'p', 'd'].includes(t) ? (
							<>
								<List.Item
									title='Mentions'
									onPress={() =>
										this.onPressTouchable({
											route: 'MessagesView',
											params: { rid, t, name: 'Mentions' }
										})
									}
									testID='room-actions-mentioned'
									left={() => <List.Icon name='mention' />}
									showActionIndicator
									disabled={hasE2EEWarning}
								/>
								<List.Separator />
							</>
						) : null}

						{['c', 'p', 'd'].includes(t) ? (
							<>
								<List.Item
									title='Starred'
									onPress={() =>
										this.onPressTouchable({
											route: 'MessagesView',
											params: { rid, t, name: 'Starred' }
										})
									}
									testID='room-actions-starred'
									left={() => <List.Icon name='star' />}
									showActionIndicator
									disabled={hasE2EEWarning}
								/>
								<List.Separator />
							</>
						) : null}

						{['c', 'p', 'd'].includes(t) ? (
							<>
								<List.Item
									title='Share'
									onPress={() =>
										this.onPressTouchable({
											event: this.handleShare
										})
									}
									testID='room-actions-share'
									left={() => <List.Icon name='share' />}
									showActionIndicator
									disabled={hasE2EEWarning}
								/>
								<List.Separator />
							</>
						) : null}

						{['c', 'p', 'd'].includes(t) ? (
							<>
								<List.Item
									title='Pinned'
									onPress={() =>
										this.onPressTouchable({
											route: 'MessagesView',
											params: { rid, t, name: 'Pinned' }
										})
									}
									testID='room-actions-pinned'
									left={() => <List.Icon name='pin' />}
									showActionIndicator
									disabled={hasE2EEWarning}
								/>
								<List.Separator />
							</>
						) : null}

						{['c', 'p', 'd'].includes(t) && canAutoTranslate ? (
							<>
								<List.Item
									title='Auto_Translate'
									onPress={() =>
										this.onPressTouchable({
											route: 'AutoTranslateView',
											params: { rid, room }
										})
									}
									testID='room-actions-auto-translate'
									left={() => <List.Icon name='language' />}
									showActionIndicator
									disabled={hasE2EEWarning}
								/>
								<List.Separator />
							</>
						) : null}

						{['c', 'p', 'd'].includes(t) && joined ? (
							<>
								<List.Item
									title='Notifications'
									onPress={() =>
										this.onPressTouchable({
											route: 'NotificationPrefView',
											params: { rid, room }
										})
									}
									testID='room-actions-notifications'
									left={() => <List.Icon name='notification' />}
									showActionIndicator
									disabled={hasE2EEWarning}
								/>
								<List.Separator />
							</>
						) : null}
					</List.Section>
					{this.renderOmnichannelSection()}
					{this.renderLastSection()}
				</List.Container>
			</SafeAreaView>
		);
	}
}

const mapStateToProps = (state: IApplicationState) => ({
	userId: getUserSelector(state).id,
	encryptionEnabled: state.encryption.enabled,
	serverVersion: state.server.version,
	isMasterDetail: state.app.isMasterDetail,
	editRoomPermission: state.permissions['edit-room'],
	toggleRoomE2EEncryptionPermission: state.permissions['toggle-room-e2e-encryption'],
	viewBroadcastMemberListPermission: state.permissions['view-broadcast-member-list'],
	createTeamPermission: state.permissions['create-team'],
	addTeamChannelPermission: state.permissions['add-team-channel'],
	moveRoomToTeamPermission: state.permissions['move-room-to-team'],
	convertTeamPermission: state.permissions['convert-team'],
	viewCannedResponsesPermission: state.permissions['view-canned-responses'],
	livechatAllowManualOnHold: state.settings.Livechat_allow_manual_on_hold as boolean,
	livechatRequestComment: state.settings.Livechat_request_comment_when_closing_conversation as boolean
});

export default connect(mapStateToProps)(withTheme(withActionSheet(withDimensions(RoomActionsView))));
