export type YCloudSmbStateSyncContact = {
  fullName?: string | null;
  firstName?: string | null;
  phoneNumber?: string | null;
  userId?: string | null;
  parentUserId?: string | null;
  username?: string | null;
};

export type YCloudSmbStateSyncItem = {
  contact?: YCloudSmbStateSyncContact | null;
  action?: string | null;
  timestamp?: number | string | null;
};

export type YCloudSmbAppStateSyncPayload = {
  id: string;
  type: 'whatsapp.smb.app.state.sync';
  apiVersion?: string | null;
  createTime?: string | null;
  whatsappSmbAppStateSync?: {
    wabaId?: string | null;
    phoneNumber?: string | null;
    stateSync?: YCloudSmbStateSyncItem[] | null;
  } | null;
};
