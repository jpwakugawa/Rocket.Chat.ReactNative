import React from 'react';
import  * as List  from '../../../containers/List';
import { IRoom } from '../../../definitions';

type OmnichannelSectionProps = {
  room: IRoom;
  omnichannelPermissions: {
    canForwardGuest: boolean;
    canPlaceLivechatOnHold: boolean;
  };
};

const ForwardGuestIcon = () => <List.Icon name='chat-forward' />;
const PauseIcon = () => <List.Icon name='pause' />;

const OmnichannelSection: React.FC<OmnichannelSectionProps> = (props: OmnichannelSectionProps) => {
  const { room, omnichannelPermissions } = props;
  if (room.t !== 'l') {
    return null;
  }

  return (
    <List.Section>
      {omnichannelPermissions?.canForwardGuest && (
        <>
          <List.Item
            title='Forward Guest'
            onPress={() => console.log('Forward Guest')}
            left={ForwardGuestIcon}
            showActionIndicator
          />
          <List.Separator />
        </>
      )}
      {omnichannelPermissions?.canPlaceLivechatOnHold && (
        <>
          <List.Item
            title='Place on Hold'
            onPress={() => console.log('Place on Hold')}
            left={PauseIcon}
            showActionIndicator
          />
          <List.Separator />
        </>
      )}
    </List.Section>
  );
};

export default OmnichannelSection;