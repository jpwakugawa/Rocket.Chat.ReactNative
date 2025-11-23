import React from 'react';
import { View } from 'react-native';
import  * as List  from '../../../containers/List';
import Avatar from '../../../containers/Avatar';
import Status from '../../../containers/Status';
import { getRoomAvatar, getRoomTitle } from '../../../lib/methods/helpers';
import { themes } from '../../../lib/constants/colors';
import sharedStyles from '../../Styles';
import { IRoom } from '../../../definitions';

type RoomInfoSectionProps = {
  room: IRoom;
  membersCount: number;
  canViewMembers: boolean;
  joined: boolean;
  navigation: any;
  isGroupChatHandler: boolean;
};

type RoomAvatarProps = {
  avatar: string;
  t: string;
  rid: string;
  room: IRoom;
};

const RoomAvatarWithStatus: React.FC<RoomAvatarProps> = (props: RoomAvatarProps) => {
  const { avatar, t, rid, room } = props;
  return (
    <Avatar text={avatar} size={50} type={t} rid={rid}>
      {t === 'd' && room.member?._id ? (
        <View style={[sharedStyles.status, { backgroundColor: themes.light.surfaceRoom }]}>
          <Status size={16} id={room.member._id} />
        </View>
      ) : null}
    </Avatar>
  );
};

const RoomInfoSection: React.FC<RoomInfoSectionProps> = (props: RoomInfoSectionProps) => {
  const { room, navigation } = props;
  const { rid, t, topic } = room;
  const avatar = getRoomAvatar(room);

  const renderAvatar = () => <RoomAvatarWithStatus avatar={avatar} t={t} rid={rid} room={room} />;

  return (
    <List.Section>
      <List.Separator />
      <List.Item
        title={getRoomTitle(room)}
        subtitle={topic}
        left={renderAvatar}
        onPress={() => navigation.navigate('RoomInfoView', { rid, room })}
        testID='room-info-section'
      />
      <List.Separator />
    </List.Section>
  );
};

export default RoomInfoSection;