// types.ts
export type SafeAreaInsets = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

export type FrameNotificationDetails = {
  url: string;
  token: string;
};

export type FrameLocationContext =
  | {
      type: 'cast_embed';
      embed: string;
      cast: {
        fid: number;
        hash: string;
      };
    }
  | {
      type: 'notification';
      notification: {
        notificationId: string;
        title: string;
        body: string;
      };
    }
  | {
      type: 'launcher';
    }
  | {
      type: 'channel';
      channel: {
        key: string;
        name: string;
        imageUrl?: string;
      };
    }
  | {
    type: 'cast_share';
    cast: {
      hash: string;
      timestamp: string;
      author?: {
        fid: number;
        username: string;
        pfp_url?: string;
      };
      channelKey?: string;
    };
  }



export type FrameContext = {
  user: {
    fid: number;
    username?: string;
    displayName?: string;
    pfpUrl?: string;
  };
  location?: FrameLocationContext;
  client: {
    clientFid: number;
    added: boolean;
    safeAreaInsets?: SafeAreaInsets;
    notificationDetails?: FrameNotificationDetails;
  };
};
