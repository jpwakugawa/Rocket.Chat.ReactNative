import React from 'react';
import  * as List  from '../../../containers/List';
import { IRoom } from '../../../definitions';

type LastSectionProps = {
  room: IRoom;
  joined: boolean;
  loading: boolean;
  theme: string;
};

const LeaveRoomIcon = () => <List.Icon name='logout' color='red' />;

const LastSection: React.FC<LastSectionProps> = (props: LastSectionProps) => {
  const { room, joined } = props;
  if (!joined || room.t === 'l') {
    return null;
  }

  return (
    <List.Section>
      <List.Separator />
      <List.Item
        title='Leave Room'
        onPress={() => console.log('Leave Room')}
        testID='last-section-leave-room'
        left={LeaveRoomIcon}
        showActionIndicator
      />
      <List.Separator />
    </List.Section>
  );
};

export default LastSection;