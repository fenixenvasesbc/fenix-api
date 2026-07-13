export type YCloudContactAttributeChange = {
  oldValue?: unknown;
  newValue?: unknown;
  extra?: unknown;
};

export type YCloudContactAttributesChangedPayload = {
  id: string;
  type: 'contact.attributes_changed';
  apiVersion?: string | null;
  createTime?: string | null;
  contactAttributesChanged?: {
    id?: string | null;
    updateTime?: string | null;
    changedAttributes?: Record<string, YCloudContactAttributeChange> | null;
  } | null;
};
