import { Timestamp } from 'firebase/firestore';

// Blueprint-synchronized volumetric limits & validation patterns
export const LIMITS = {
  ID_MAX: 128,
  ID_PATTERN: /^[a-zA-Z0-9_-]+$/,
  DISPLAY_NAME_MAX: 80,
  BIO_MAX: 160,
  PHOTO_URL_MAX: 500,
  EMAIL_MAX: 120,
  PHONE_MAX: 24,
  PHONE_PATTERN: /^(\+[0-9]{6,15})?$/,
  CHAT_TITLE_MAX: 100,
  TARGET_HINT_MAX: 80,
  INVITE_CODE_MAX: 16,
  LAST_MESSAGE_MAX: 200,
  MESSAGE_TEXT_MAX: 2000,
  ATTACHMENT_NAME_MAX: 140,
  ATTACHMENT_MIME_MAX: 100,
  ATTACHMENT_DATA_MAX: 800000,
  ATTACHMENT_INLINE_THRESHOLD: 750000,
  ATTACHMENT_CHUNK_SIZE: 650000,
  ATTACHMENT_FILE_BYTES_MAX: 10485760,
  STATUS_TEXT_MAX: 300,
  STATUS_IMAGE_DATA_MAX: 800000,
  SDP_MAX: 12000,
  CANDIDATE_MAX: 2000,
  CALL_SDP_MAX: 24000,
  CALL_CANDIDATE_MAX: 2500,
  MAX_PARTICIPANTS: 10,
} as const;

export type CallMode = 'audio' | 'video';
export type CallStateStatus = 'ringing' | 'connected' | 'declined' | 'ended' | 'missed';

export interface CallSession {
  id: string;
  chatId: string;
  callerUid: string;
  callerName: string;
  callerPhoto: string;
  calleeUid: string;
  calleeName: string;
  calleePhoto: string;
  participantIds: string[];
  mode: CallMode;
  status: CallStateStatus;
  offerSdp: string;
  answerSdp: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface CallCandidate {
  id: string;
  senderId: string;
  candidate: string;
  createdAt: Timestamp | null;
}

export type ChatChannel = 'gmail' | 'phone' | 'nearby';
export type MessageTransport = 'gmail' | 'phone' | 'internet' | 'nearby' | 'bluetooth';
export type AttachmentType = 'none' | 'image' | 'file';
export type AppLanguage = 'en' | 'bn';
export type AppTheme = 'glass' | 'dark' | 'light';
export type StatusBgGradient = 'blue' | 'emerald' | 'amber' | 'rose' | 'slate';

export const STATUS_REACTION_EMOJIS = ['❤️', '👍', '🔥', '😂', '😮', '😢'] as const;
export type StatusReactionEmoji = (typeof STATUS_REACTION_EMOJIS)[number];

export interface UserStatus {
  id: string;
  uid: string;
  displayName: string;
  photoUrl: string;
  mediaType: 'text' | 'image';
  text: string;
  bgGradient: StatusBgGradient;
  imageData: string;
  createdAt: Timestamp | null;
  expiresAt: Timestamp | null;
}

export interface StatusReaction {
  id: string;
  statusId: string;
  uid: string;
  displayName: string;
  photoUrl: string;
  emoji: StatusReactionEmoji;
  updatedAt: Timestamp | null;
}

export interface StatusComment {
  id: string;
  statusId: string;
  uid: string;
  displayName: string;
  photoUrl: string;
  text: string;
  createdAt: Timestamp | null;
}

export interface PreparedAttachment {
  attachmentType: Exclude<AttachmentType, 'none'>;
  attachmentName: string;
  attachmentMime: string;
  attachmentSize: number;
  attachmentData: string;
}

export interface UserPublicProfile {
  uid: string;
  displayName: string;
  photoUrl: string;
  bio: string;
  maskedEmail?: string;
  hasPhone: boolean;
  showOnlineStatus?: boolean;
  onlineStatus: 'online' | 'away' | 'offline';
  lastSeenAt: Timestamp | null;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface UserPrivateInfo {
  uid: string;
  email: string;
  phoneNumber: string;
  language: AppLanguage;
  updatedAt: Timestamp | null;
}

export interface DirectoryEntry {
  uid: string;
  displayName: string;
  photoUrl: string;
  updatedAt: Timestamp | null;
}

export interface ChatRoom {
  id: string;
  channel: ChatChannel;
  title: string;
  targetHint: string;
  creatorId: string;
  creatorName: string;
  peerName: string;
  participantIds: string[];
  inviteCode: string;
  pendingRecipientHash?: string;
  participantEmails?: Record<string, string>;
  lastMessageText: string;
  lastMessageSenderId: string;
  lastMessageAt: Timestamp | null;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface PendingDelivery {
  id: string;
  recipientHash: string;
  chatId: string;
  creatorId: string;
  creatorName: string;
  createdAt: Timestamp | null;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  senderId: string;
  senderName: string;
  text: string;
  attachmentType?: AttachmentType;
  attachmentName?: string;
  attachmentMime?: string;
  attachmentSize?: number;
  attachmentData?: string;
  transport: MessageTransport;
  replyToText: string;
  createdAt: Timestamp | null;
  deliveredAt?: Timestamp | null;
  readAt?: Timestamp | null;
  optimistic?: boolean;
}

export interface ChatInvite {
  code: string;
  chatId: string;
  creatorId: string;
  creatorName: string;
  channel: ChatChannel;
  createdAt: Timestamp | null;
}

export interface NearbyRoom {
  code: string;
  hostUid: string;
  hostName: string;
  guestUid: string;
  guestName: string;
  offerSdp: string;
  answerSdp: string;
  status: 'waiting' | 'paired' | 'closed';
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface LocalDirectMessage {
  id: string;
  sender: 'me' | 'peer' | 'system';
  senderName: string;
  text: string;
  transport: 'bluetooth' | 'webrtc' | 'nearby';
  timestamp: number;
  attachmentType?: AttachmentType;
  attachmentName?: string;
  attachmentMime?: string;
  attachmentSize?: number;
  attachmentData?: string;
}

export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥'] as const;
export const EXTRA_REACTION_EMOJIS = [
  '👏', '🎉', '😍', '🥰', '😘', '🤔', '🤯', '😭',
  '😡', '💯', '✨', '🤝', '🙌', '👀', '💀', '🥳',
  '🤩', '🤗', '🫡', '🫶', '⚡', '🌹', '☕', '💪',
  '✅', '❌', '👌', '😎',
] as const;
export type ReactionEmoji = string;

export interface MessageReaction {
  id: string;
  messageId: string;
  uid: string;
  emoji: ReactionEmoji;
  updatedAt: Timestamp | null;
}

export interface TypingStatus {
  uid: string;
  displayName: string;
  isTyping: boolean;
  updatedAt: Timestamp | null;
}

export interface GeminiChatTurn {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  model?: string;
  reactions?: Partial<Record<ReactionEmoji, number>>;
}
