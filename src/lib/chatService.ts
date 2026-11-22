import { deleteUser, reauthenticateWithPopup, User } from 'firebase/auth';
import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  DocumentReference,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  Unsubscribe,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { splitDataUrlIntoChunks } from './attachments';
import {
  AppLanguage,
  ChatChannel,
  ChatInvite,
  ChatMessage,
  ChatRoom,
  DirectoryEntry,
  LIMITS,
  MessageReaction,
  MessageTransport,
  PendingDelivery,
  PreparedAttachment,
  ReactionEmoji,
  StatusBgGradient,
  StatusComment,
  StatusReaction,
  StatusReactionEmoji,
  TypingStatus,
  UserPrivateInfo,
  UserPublicProfile,
  UserStatus,
} from '../types/chat';
import {
  db,
  googleProvider,
  handleFirestoreError,
  logFirestoreError,
  maskEmail,
  normalizeEmail,
  OperationType,
  sanitizeStr,
  sha256Hex,
} from './firebase';

export function formatFriendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.error === 'string') {
      if (parsed.error.includes('Missing or insufficient permissions')) {
        return `Permission denied (${parsed.operationType || 'write'} on ${parsed.path || 'database'}). Please make sure you are signed in with a verified Gmail account.`;
      }
      return parsed.error;
    }
  } catch {
    // Not JSON
  }
  return raw || 'Something went wrong. Please try again.';
}

function reportListenerError(
  err: unknown,
  op: OperationType,
  path: string,
  onError?: (friendlyMessage: string) => void
): void {
  const info = logFirestoreError(err, op, path);
  onError?.(formatFriendlyError(JSON.stringify(info)));
}

function makeRandomCode(length = 6): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < length; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

export async function ensureUserProfile(user: User): Promise<{
  publicProfile: UserPublicProfile;
  privateInfo: UserPrivateInfo;
}> {
  const userRef = doc(db, 'users', user.uid);
  const privateRef = doc(db, 'users', user.uid, 'private', 'info');

  const displayName = sanitizeStr(
    user.displayName || user.email?.split('@')[0] || 'KothaLink User',
    LIMITS.DISPLAY_NAME_MAX
  );
  const photoUrl = sanitizeStr(user.photoURL || '', LIMITS.PHOTO_URL_MAX);
  const email = sanitizeStr(normalizeEmail(user.email || ''), LIMITS.EMAIL_MAX);

  let existingPublic: UserPublicProfile | null = null;
  let existingPrivate: UserPrivateInfo | null = null;

  try {
    const pubSnap = await getDoc(userRef);
    if (pubSnap.exists()) {
      existingPublic = pubSnap.data() as UserPublicProfile;
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `users/${user.uid}`);
  }

  try {
    const privSnap = await getDoc(privateRef);
    if (privSnap.exists()) {
      existingPrivate = privSnap.data() as UserPrivateInfo;
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `users/${user.uid}/private/info`);
  }

  const batch = writeBatch(db);

  const safeDisplayName = displayName || 'KothaLink User';

  if (!existingPublic) {
    batch.set(userRef, {
      uid: user.uid,
      displayName: safeDisplayName,
      photoUrl,
      bio: 'Available on KothaLink',
      hasPhone: false,
      showOnlineStatus: true,
      onlineStatus: 'online',
      lastSeenAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } else {
    // Backfill any required schema fields missing on legacy user documents so Firestore rules pass cleanly
    const pubUpdates: Record<string, unknown> = {
      onlineStatus: 'online',
      lastSeenAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (typeof existingPublic.displayName !== 'string' || !existingPublic.displayName.trim()) {
      pubUpdates.displayName = safeDisplayName;
    }
    if (typeof existingPublic.photoUrl !== 'string') {
      pubUpdates.photoUrl = photoUrl;
    }
    if (typeof existingPublic.bio !== 'string') {
      pubUpdates.bio = 'Available on KothaLink';
    }
    if (typeof existingPublic.hasPhone !== 'boolean') {
      pubUpdates.hasPhone = false;
    }
    if (typeof existingPublic.showOnlineStatus !== 'boolean') {
      pubUpdates.showOnlineStatus = true;
    }
    batch.update(userRef, pubUpdates);
  }

  if (!existingPrivate) {
    batch.set(privateRef, {
      uid: user.uid,
      email,
      phoneNumber: '',
      language: 'en',
      updatedAt: serverTimestamp(),
    });
  } else {
    const privUpdates: Record<string, unknown> = {};
    if (email && existingPrivate.email !== email) {
      privUpdates.email = email;
    }
    if (typeof existingPrivate.phoneNumber !== 'string') {
      privUpdates.phoneNumber = '';
    }
    if (existingPrivate.language !== 'en' && existingPrivate.language !== 'bn') {
      privUpdates.language = 'en';
    }
    if (Object.keys(privUpdates).length > 0) {
      privUpdates.updatedAt = serverTimestamp();
      batch.update(privateRef, privUpdates);
    }
  }

  // Register SHA-256 email directory entry so friends can find this user by Gmail
  if (email) {
    const emailHash = await sha256Hex(email);
    const dirRef = doc(db, 'email_directory', emailHash);
    let dirExists = false;
    try {
      const dirSnap = await getDoc(dirRef);
      dirExists = dirSnap.exists();
    } catch {
      dirExists = false;
    }
    if (!dirExists) {
      batch.set(dirRef, {
        uid: user.uid,
        displayName: existingPublic?.displayName || safeDisplayName,
        photoUrl: existingPublic?.photoUrl || photoUrl,
        updatedAt: serverTimestamp(),
      });
    }
  }

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`);
  }

  const [freshPub, freshPriv] = await Promise.all([
    getDoc(userRef).catch((e) => handleFirestoreError(e, OperationType.GET, `users/${user.uid}`)),
    getDoc(privateRef).catch((e) => handleFirestoreError(e, OperationType.GET, `users/${user.uid}/private/info`)),
  ]);

  return {
    publicProfile: freshPub.data() as UserPublicProfile,
    privateInfo: freshPriv.data() as UserPrivateInfo,
  };
}

export async function updateUserSettings(params: {
  uid: string;
  email: string;
  displayName: string;
  bio: string;
  photoUrl: string;
  language: AppLanguage;
  showOnlineStatus?: boolean;
}): Promise<void> {
  const cleanName = sanitizeStr(params.displayName, LIMITS.DISPLAY_NAME_MAX) || 'KothaLink User';
  const cleanBio = sanitizeStr(params.bio, LIMITS.BIO_MAX);
  const cleanPhoto = sanitizeStr(params.photoUrl, LIMITS.PHOTO_URL_MAX);

  const batch = writeBatch(db);
  const userRef = doc(db, 'users', params.uid);
  const privateRef = doc(db, 'users', params.uid, 'private', 'info');

  const userUpdates: Record<string, unknown> = {
    displayName: cleanName,
    bio: cleanBio,
    hasPhone: false,
    updatedAt: serverTimestamp(),
  };
  if (typeof params.showOnlineStatus === 'boolean') {
    userUpdates.showOnlineStatus = params.showOnlineStatus;
  }
  batch.update(userRef, userUpdates);

  batch.update(privateRef, {
    phoneNumber: '',
    language: params.language,
    updatedAt: serverTimestamp(),
  });

  // Update email directory display name if email exists
  if (params.email) {
    const emailHash = await sha256Hex(normalizeEmail(params.email));
    const emailDirRef = doc(db, 'email_directory', emailHash);
    try {
      const snap = await getDoc(emailDirRef);
      if (snap.exists() && snap.data().uid === params.uid) {
        batch.update(emailDirRef, {
          displayName: cleanName,
          photoUrl: cleanPhoto,
          updatedAt: serverTimestamp(),
        });
      }
    } catch {
      // Ignore if not present
    }
  }

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${params.uid}`);
  }
}

export async function updateUserPresence(
  uid: string,
  onlineStatus: 'online' | 'away' | 'offline'
): Promise<void> {
  if (!uid) return;
  try {
    await updateDoc(doc(db, 'users', uid), {
      onlineStatus,
      lastSeenAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Presence heartbeat is best-effort; ignore transient network/unmount issues
  }
}

export function subscribeUserProfiles(
  uids: string[],
  onProfiles: (profiles: Record<string, UserPublicProfile>) => void
): Unsubscribe {
  const uniqueUids = Array.from(new Set(uids.filter((id) => Boolean(id) && LIMITS.ID_PATTERN.test(id))));
  if (uniqueUids.length === 0) {
    onProfiles({});
    return () => {};
  }

  const profileMap: Record<string, UserPublicProfile> = {};
  const unsubs: Unsubscribe[] = [];

  for (const uid of uniqueUids) {
    const unsub = onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        if (snap.exists()) {
          profileMap[uid] = snap.data() as UserPublicProfile;
          onProfiles({ ...profileMap });
        }
      },
      () => {
        // Ignore transient profile read errors for deleted/missing peers
      }
    );
    unsubs.push(unsub);
  }

  return () => {
    unsubs.forEach((u) => u());
  };
}

export function subscribeUserChats(
  uid: string,
  onChats: (chats: ChatRoom[]) => void,
  onError?: (friendlyMessage: string) => void
): Unsubscribe {
  const q = query(
    collection(db, 'chats'),
    where('participantIds', 'array-contains', uid)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs
        .map((d) => d.data() as ChatRoom)
        .sort((a, b) => {
          const tA = a.lastMessageAt?.toMillis?.() ?? 0;
          const tB = b.lastMessageAt?.toMillis?.() ?? 0;
          return tB - tA;
        });
      onChats(list);
    },
    (err) => reportListenerError(err, OperationType.LIST, 'chats', onError)
  );
}

export function subscribeChatMessages(
  chatId: string,
  onMessages: (messages: ChatMessage[]) => void,
  onError?: (friendlyMessage: string) => void
): Unsubscribe {
  const path = `chats/${chatId}/messages`;
  const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('createdAt', 'asc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const msgs = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<ChatMessage, 'id'>),
      }));
      onMessages(msgs);
    },
    (err) => reportListenerError(err, OperationType.LIST, path, onError)
  );
}

function findExistingDirectChat(
  existingChats: ChatRoom[],
  currentUid: string,
  peerUid: string
): ChatRoom | undefined {
  return existingChats.find(
    (c) =>
      c.participantIds.length === 2 &&
      c.participantIds.includes(currentUid) &&
      c.participantIds.includes(peerUid)
  );
}

async function findExistingDirectChatOnServer(
  sortedUids: string[]
): Promise<ChatRoom | null> {
  const candidateIds = [
    `dm_${sortedUids[0]}_${sortedUids[1]}`.slice(0, LIMITS.ID_MAX),
    `dm_g_${sortedUids[0]}_${sortedUids[1]}`.slice(0, LIMITS.ID_MAX),
    `dm_p_${sortedUids[0]}_${sortedUids[1]}`.slice(0, LIMITS.ID_MAX),
  ];
  for (const cid of candidateIds) {
    try {
      const snap = await getDoc(doc(db, 'chats', cid));
      if (snap.exists()) {
        return snap.data() as ChatRoom;
      }
    } catch {
      // Not a member or doc doesn't exist yet; continue checking candidates
    }
  }
  return null;
}

function findExistingPendingChat(
  existingChats: ChatRoom[],
  currentUid: string,
  targetHint: string
): ChatRoom | undefined {
  return existingChats.find(
    (c) =>
      c.creatorId === currentUid &&
      c.participantIds.length === 1 &&
      c.targetHint === targetHint &&
      Boolean(c.inviteCode)
  );
}

export async function startChatByGmail(params: {
  currentUser: UserPublicProfile;
  targetGmail: string;
  existingChats: ChatRoom[];
}): Promise<{ chatId: string; isPendingInvite: boolean; inviteCode: string }> {
  const cleanEmail = normalizeEmail(params.targetGmail);
  if (!cleanEmail || !cleanEmail.includes('@')) {
    throw new Error('Please enter a valid Gmail or email address.');
  }

  const emailHash = await sha256Hex(cleanEmail);
  let peerEntry: DirectoryEntry | null = null;
  try {
    const snap = await getDoc(doc(db, 'email_directory', emailHash));
    if (snap.exists()) peerEntry = snap.data() as DirectoryEntry;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `email_directory/${emailHash}`);
  }

  if (peerEntry && peerEntry.uid === params.currentUser.uid) {
    throw new Error('You entered your own Gmail address. Enter a friend’s Gmail to chat.');
  }

  if (peerEntry) {
    const existingLocal = findExistingDirectChat(
      params.existingChats,
      params.currentUser.uid,
      peerEntry.uid
    );
    if (existingLocal) {
      return { chatId: existingLocal.id, isPendingInvite: false, inviteCode: existingLocal.inviteCode };
    }

    const sorted = [params.currentUser.uid, peerEntry.uid].sort();
    const existingRemote = await findExistingDirectChatOnServer(sorted);
    if (existingRemote) {
      return {
        chatId: existingRemote.id,
        isPendingInvite: false,
        inviteCode: existingRemote.inviteCode,
      };
    }

    const chatId = `dm_${sorted[0]}_${sorted[1]}`.slice(0, LIMITS.ID_MAX);
    const peerLabel = sanitizeStr(peerEntry.displayName, LIMITS.CHAT_TITLE_MAX) || 'Friend';
    const creatorLabel = sanitizeStr(params.currentUser.displayName, LIMITS.DISPLAY_NAME_MAX) || 'User';
    try {
      await setDoc(doc(db, 'chats', chatId), {
        id: chatId,
        channel: 'gmail' as ChatChannel,
        title: peerLabel,
        targetHint: sanitizeStr(maskEmail(cleanEmail), LIMITS.TARGET_HINT_MAX),
        creatorId: params.currentUser.uid,
        creatorName: creatorLabel,
        peerName: sanitizeStr(peerLabel, LIMITS.DISPLAY_NAME_MAX) || 'Friend',
        participantIds: sorted,
        inviteCode: '',
        lastMessageText: 'Connected via Gmail',
        lastMessageSenderId: params.currentUser.uid,
        lastMessageAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `chats/${chatId}`);
    }

    return { chatId, isPendingInvite: false, inviteCode: '' };
  }

  // Friend hasn't signed in yet -> reuse existing pending invite for same Gmail if present
  const maskedTarget = sanitizeStr(maskEmail(cleanEmail), LIMITS.TARGET_HINT_MAX) || 'Gmail user';
  const existingPending = findExistingPendingChat(
    params.existingChats,
    params.currentUser.uid,
    maskedTarget
  );
  if (existingPending) {
    return {
      chatId: existingPending.id,
      isPendingInvite: true,
      inviteCode: existingPending.inviteCode,
    };
  }

  const inviteCode = makeRandomCode(6);
  const chatId = `inv_g_${Date.now().toString(36)}_${makeRandomCode(4)}`;
  const creatorLabel = sanitizeStr(params.currentUser.displayName, LIMITS.DISPLAY_NAME_MAX) || 'User';

  try {
    await setDoc(doc(db, 'chats', chatId), {
      id: chatId,
      channel: 'gmail' as ChatChannel,
      title: sanitizeStr(cleanEmail.split('@')[0] || 'Gmail Invite', LIMITS.CHAT_TITLE_MAX) || 'Gmail Invite',
      targetHint: maskedTarget,
      creatorId: params.currentUser.uid,
      creatorName: creatorLabel,
      peerName: maskedTarget,
      participantIds: [params.currentUser.uid],
      inviteCode,
      pendingRecipientHash: emailHash,
      lastMessageText: `Waiting for ${maskedTarget}`,
      lastMessageSenderId: params.currentUser.uid,
      lastMessageAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `chats/${chatId}`);
  }

  try {
    await setDoc(doc(db, 'chat_invites', inviteCode), {
      code: inviteCode,
      chatId,
      creatorId: params.currentUser.uid,
      creatorName: creatorLabel,
      channel: 'gmail' as ChatChannel,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `chat_invites/${inviteCode}`);
  }

  const deliveryId = `${emailHash}_${chatId}`;
  try {
    await setDoc(doc(db, 'pending_deliveries', deliveryId), {
      id: deliveryId,
      recipientHash: emailHash,
      chatId,
      creatorId: params.currentUser.uid,
      creatorName: creatorLabel,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `pending_deliveries/${deliveryId}`);
  }

  return { chatId, isPendingInvite: true, inviteCode };
}

export async function claimPendingEmailChats(params: {
  user: User;
  currentUser: UserPublicProfile;
}): Promise<number> {
  const rawEmail = params.user.email || '';
  if (!rawEmail) return 0;

  const targetHash = await sha256Hex(normalizeEmail(rawEmail));
  let snap;
  try {
    snap = await getDocs(
      query(collection(db, 'pending_deliveries'), where('recipientHash', '==', targetHash))
    );
  } catch {
    return 0;
  }
  if (snap.empty) return 0;

  let claimedCount = 0;
  const peerLabel = sanitizeStr(params.currentUser.displayName, LIMITS.DISPLAY_NAME_MAX) || 'Friend';

  for (const d of snap.docs) {
    const delivery = d.data() as PendingDelivery;
    if (!delivery?.chatId || delivery.creatorId === params.user.uid) continue;
    try {
      await updateDoc(doc(db, 'chats', delivery.chatId), {
        participantIds: arrayUnion(params.user.uid),
        peerName: peerLabel,
        pendingRecipientHash: '',
        updatedAt: serverTimestamp(),
      });
      claimedCount += 1;
    } catch {
      // May already be claimed or deleted; still attempt cleanup of delivery index
    }
    try {
      await deleteDoc(d.ref);
    } catch {
      // Best-effort cleanup
    }
  }

  return claimedCount;
}

export async function joinChatByInviteCode(params: {
  currentUser: UserPublicProfile;
  inviteCodeRaw: string;
  existingChats: ChatRoom[];
}): Promise<string> {
  const code = params.inviteCodeRaw.trim().toUpperCase();
  if (!code || code.length < 4 || code.length > LIMITS.INVITE_CODE_MAX) {
    throw new Error('Invalid invite code.');
  }

  let invite: ChatInvite | null = null;
  try {
    const snap = await getDoc(doc(db, 'chat_invites', code));
    if (!snap.exists()) {
      throw new Error('Invite code not found or expired.');
    }
    invite = snap.data() as ChatInvite;
  } catch (err) {
    if (err instanceof Error && err.message.includes('Invite code not found')) throw err;
    handleFirestoreError(err, OperationType.GET, `chat_invites/${code}`);
  }

  if (!invite) throw new Error('Invite code not found.');

  if (invite.creatorId === params.currentUser.uid) {
    return invite.chatId;
  }

  const alreadyMember = params.existingChats.find(
    (c) => c.id === invite.chatId || c.inviteCode === code
  );
  if (alreadyMember) {
    return alreadyMember.id;
  }

  try {
    await updateDoc(doc(db, 'chats', invite.chatId), {
      participantIds: arrayUnion(params.currentUser.uid),
      peerName: sanitizeStr(params.currentUser.displayName, LIMITS.DISPLAY_NAME_MAX),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `chats/${invite.chatId}`);
  }

  return invite.chatId;
}

export function createClientMessageId(chatId: string): string {
  return doc(collection(db, 'chats', chatId, 'messages')).id;
}

const resolvedAttachmentCache = new Map<string, string>();

export async function resolveChunkedAttachment(
  chatId: string,
  messageId: string,
  inlineOrMarker: string
): Promise<string> {
  if (!inlineOrMarker) return '';
  if (!inlineOrMarker.startsWith('chunked:')) return inlineOrMarker;

  const cacheKey = `${chatId}_${messageId}`;
  const cached = resolvedAttachmentCache.get(cacheKey);
  if (cached) return cached;

  const path = `chats/${chatId}/messages/${messageId}/chunks`;
  try {
    const q = query(
      collection(db, 'chats', chatId, 'messages', messageId, 'chunks'),
      orderBy('chunkIndex', 'asc')
    );
    const snap = await getDocs(q);
    const fullData = snap.docs
      .map((d) => d.data() as { chunkIndex: number; data: string })
      .sort((a, b) => a.chunkIndex - b.chunkIndex)
      .map((c) => c.data)
      .join('');
    if (fullData) {
      resolvedAttachmentCache.set(cacheKey, fullData);
    }
    return fullData;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function sendChatMessage(params: {
  chat: ChatRoom;
  sender: UserPublicProfile;
  text: string;
  replyToText?: string;
  clientMessageId?: string;
  attachment?: PreparedAttachment | null;
  onProgress?: (percent: number) => void;
}): Promise<void> {
  const cleanText = sanitizeStr(params.text, LIMITS.MESSAGE_TEXT_MAX);
  const att = params.attachment;
  if (!cleanText && !att) return;

  const cleanReply = sanitizeStr(params.replyToText || '', 200);
  const transport: MessageTransport =
    params.chat.channel === 'gmail' ? 'gmail' : params.chat.channel === 'phone' ? 'phone' : 'nearby';

  const msgRef = params.clientMessageId
    ? doc(db, 'chats', params.chat.id, 'messages', params.clientMessageId)
    : doc(collection(db, 'chats', params.chat.id, 'messages'));
  const chatRef = doc(db, 'chats', params.chat.id);

  const attachmentType = att ? att.attachmentType : 'none';
  const attachmentName = att
    ? sanitizeStr(att.attachmentName, LIMITS.ATTACHMENT_NAME_MAX) || 'attachment'
    : '';
  const attachmentMime = att ? sanitizeStr(att.attachmentMime, LIMITS.ATTACHMENT_MIME_MAX) : '';
  const attachmentSize = att
    ? Math.min(Math.max(0, Math.round(att.attachmentSize)), LIMITS.ATTACHMENT_FILE_BYTES_MAX)
    : 0;

  let storedAttachmentData = '';
  if (att) {
    if (att.attachmentData.length <= LIMITS.ATTACHMENT_INLINE_THRESHOLD) {
      storedAttachmentData = att.attachmentData;
      params.onProgress?.(90);
    } else {
      const chunks = splitDataUrlIntoChunks(att.attachmentData);
      // Write 2 chunks per batch (~1.3MB max) for rock-solid reliability on mobile connections
      for (let start = 0; start < chunks.length; start += 2) {
        const chunkBatch = writeBatch(db);
        const slice = chunks.slice(start, start + 2);
        slice.forEach((chunkStr, offset) => {
          const idx = start + offset;
          const chunkRef = doc(
            db,
            'chats',
            params.chat.id,
            'messages',
            msgRef.id,
            'chunks',
            `c_${idx}`
          );
          chunkBatch.set(chunkRef, {
            messageId: msgRef.id,
            senderId: params.sender.uid,
            chunkIndex: idx,
            data: chunkStr,
            createdAt: serverTimestamp(),
          });
        });
        try {
          await chunkBatch.commit();
          const done = Math.min(chunks.length, start + slice.length);
          params.onProgress?.(Math.round((done / chunks.length) * 90));
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `chats/${params.chat.id}/messages/${msgRef.id}/chunks`);
        }
      }
      storedAttachmentData = `chunked:${chunks.length}`;
      resolvedAttachmentCache.set(`${params.chat.id}_${msgRef.id}`, att.attachmentData);
    }
  }

  const previewText = cleanText
    ? cleanText
    : attachmentType === 'image'
    ? `Photo: ${attachmentName}`
    : `File: ${attachmentName}`;

  const batch = writeBatch(db);
  batch.set(msgRef, {
    chatId: params.chat.id,
    senderId: params.sender.uid,
    senderName: sanitizeStr(params.sender.displayName, LIMITS.DISPLAY_NAME_MAX) || 'User',
    text: cleanText,
    attachmentType,
    attachmentName,
    attachmentMime,
    attachmentSize,
    attachmentData: storedAttachmentData,
    transport,
    replyToText: cleanReply,
    createdAt: serverTimestamp(),
  });

  batch.update(chatRef, {
    lastMessageText: sanitizeStr(previewText, LIMITS.LAST_MESSAGE_MAX),
    lastMessageSenderId: params.sender.uid,
    lastMessageAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    params.onProgress?.(100);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `chats/${params.chat.id}/messages`);
  }
}

export function subscribeChatReactions(
  chatId: string,
  onReactions: (reactions: MessageReaction[]) => void
): Unsubscribe {
  const path = `chats/${chatId}/reactions`;
  return onSnapshot(
    collection(db, 'chats', chatId, 'reactions'),
    (snapshot) => {
      const list = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<MessageReaction, 'id'>),
      }));
      onReactions(list);
    },
    (err) => reportListenerError(err, OperationType.LIST, path)
  );
}

export async function toggleMessageReaction(params: {
  chatId: string;
  messageId: string;
  uid: string;
  emoji: ReactionEmoji;
  currentEmoji?: ReactionEmoji | null;
}): Promise<void> {
  const reactionId = `${params.messageId}_${params.uid}`;
  const path = `chats/${params.chatId}/reactions/${reactionId}`;
  const ref = doc(db, 'chats', params.chatId, 'reactions', reactionId);

  try {
    if (params.currentEmoji === params.emoji) {
      await deleteDoc(ref);
    } else {
      await setDoc(ref, {
        messageId: params.messageId,
        uid: params.uid,
        emoji: params.emoji,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export function subscribeTypingStatus(
  chatId: string,
  onTypingChange: (statuses: TypingStatus[]) => void
): Unsubscribe {
  const path = `chats/${chatId}/typing`;
  return onSnapshot(
    collection(db, 'chats', chatId, 'typing'),
    (snapshot) => {
      const list = snapshot.docs.map((d) => d.data() as TypingStatus);
      onTypingChange(list);
    },
    (err) => reportListenerError(err, OperationType.LIST, path)
  );
}

export async function setTypingStatus(params: {
  chatId: string;
  user: UserPublicProfile;
  isTyping: boolean;
}): Promise<void> {
  const ref = doc(db, 'chats', params.chatId, 'typing', params.user.uid);
  try {
    await setDoc(ref, {
      uid: params.user.uid,
      displayName: sanitizeStr(params.user.displayName, LIMITS.DISPLAY_NAME_MAX) || 'User',
      isTyping: params.isTyping,
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Non-blocking ephemeral typing indicator; ignore transient failures
  }
}

async function deleteDocRefsInBatches(refs: DocumentReference[]): Promise<void> {
  for (let i = 0; i < refs.length; i += 250) {
    const batch = writeBatch(db);
    refs.slice(i, i + 250).forEach((r) => batch.delete(r));
    await batch.commit();
  }
}

export async function deleteChatRoom(params: {
  chat: ChatRoom;
  currentUid: string;
}): Promise<void> {
  const chatId = params.chat.id;
  const refsToDelete: DocumentReference[] = [];

  try {
    const msgsSnap = await getDocs(collection(db, 'chats', chatId, 'messages'));
    for (const msgDoc of msgsSnap.docs) {
      const msgData = msgDoc.data() as { attachmentData?: string };
      if (msgData.attachmentData && msgData.attachmentData.startsWith('chunked:')) {
        const chunksSnap = await getDocs(collection(db, 'chats', chatId, 'messages', msgDoc.id, 'chunks'));
        chunksSnap.docs.forEach((c) => refsToDelete.push(c.ref));
      }
      refsToDelete.push(msgDoc.ref);
    }

    const [reactSnap, typingSnap] = await Promise.all([
      getDocs(collection(db, 'chats', chatId, 'reactions')),
      getDocs(collection(db, 'chats', chatId, 'typing')),
    ]);
    reactSnap.docs.forEach((r) => refsToDelete.push(r.ref));
    typingSnap.docs.forEach((t) => refsToDelete.push(t.ref));

    await deleteDocRefsInBatches(refsToDelete);

    if (params.chat.inviteCode && params.chat.creatorId === params.currentUid) {
      try {
        await deleteDoc(doc(db, 'chat_invites', params.chat.inviteCode));
      } catch {
        // Ignore if already deleted
      }
    }

    if (params.chat.pendingRecipientHash && params.chat.creatorId === params.currentUid) {
      try {
        await deleteDoc(doc(db, 'pending_deliveries', `${params.chat.pendingRecipientHash}_${chatId}`));
      } catch {
        // Ignore if already deleted
      }
    }

    await deleteDoc(doc(db, 'chats', chatId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `chats/${chatId}`);
  }
}

export async function deleteUserAccount(
  user: User,
  privateInfo: UserPrivateInfo | null
): Promise<void> {
  const uid = user.uid;

  try {
    const statusesSnap = await getDocs(query(collection(db, 'statuses'), where('uid', '==', uid)));
    await deleteDocRefsInBatches(statusesSnap.docs.map((d) => d.ref));
  } catch {
    // Continue cleanup
  }

  if (privateInfo?.email) {
    try {
      const emailHash = await sha256Hex(normalizeEmail(privateInfo.email));
      await deleteDoc(doc(db, 'email_directory', emailHash));
    } catch {
      // Ignore if not present
    }
  }
  if (privateInfo?.phoneNumber) {
    try {
      const phoneHash = await sha256Hex(privateInfo.phoneNumber);
      await deleteDoc(doc(db, 'phone_directory', phoneHash));
    } catch {
      // Ignore if not present
    }
  }

  try {
    await deleteDoc(doc(db, 'users', uid, 'private', 'info'));
  } catch {
    // Ignore if already removed
  }

  try {
    await deleteDoc(doc(db, 'users', uid));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `users/${uid}`);
  }

  try {
    await deleteUser(user);
  } catch (err) {
    const code = (err as { code?: string })?.code || '';
    if (code === 'auth/requires-recent-login') {
      await reauthenticateWithPopup(user, googleProvider);
      await deleteUser(user);
    } else {
      throw err;
    }
  }
}

export async function createUserStatus(params: {
  user: UserPublicProfile;
  mediaType: 'text' | 'image';
  text: string;
  bgGradient: StatusBgGradient;
  imageData?: string;
}): Promise<string> {
  const cleanText = sanitizeStr(params.text, LIMITS.STATUS_TEXT_MAX);
  const cleanImage = params.mediaType === 'image' ? params.imageData || '' : '';

  if (params.mediaType === 'text' && !cleanText) {
    throw new Error('Please write something for your status.');
  }
  if (params.mediaType === 'image' && (!cleanImage || cleanImage.length > LIMITS.STATUS_IMAGE_DATA_MAX)) {
    throw new Error('Selected photo is too large for status.');
  }

  const ref = doc(collection(db, 'statuses'));
  const expiresAt = Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000);

  try {
    await setDoc(ref, {
      id: ref.id,
      uid: params.user.uid,
      displayName: sanitizeStr(params.user.displayName, LIMITS.DISPLAY_NAME_MAX) || 'User',
      photoUrl: sanitizeStr(params.user.photoUrl || '', LIMITS.PHOTO_URL_MAX),
      mediaType: params.mediaType,
      text: cleanText,
      bgGradient: params.bgGradient,
      imageData: cleanImage,
      createdAt: serverTimestamp(),
      expiresAt,
    });
    return ref.id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `statuses/${ref.id}`);
  }
}

export async function deleteUserStatus(statusId: string): Promise<void> {
  try {
    const [reactSnap, commentSnap] = await Promise.all([
      getDocs(collection(db, 'statuses', statusId, 'reactions')),
      getDocs(collection(db, 'statuses', statusId, 'comments')),
    ]);
    const refs: DocumentReference[] = [
      ...reactSnap.docs.map((d) => d.ref),
      ...commentSnap.docs.map((d) => d.ref),
    ];
    if (refs.length > 0) {
      await deleteDocRefsInBatches(refs);
    }
    await deleteDoc(doc(db, 'statuses', statusId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `statuses/${statusId}`);
  }
}

export function subscribeStatusReactions(
  statusId: string,
  onReactions: (reactions: StatusReaction[]) => void,
  onError?: (friendlyMessage: string) => void
): Unsubscribe {
  const path = `statuses/${statusId}/reactions`;
  const q = query(collection(db, 'statuses', statusId, 'reactions'), where('statusId', '==', statusId));
  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<StatusReaction, 'id'>),
      }));
      onReactions(list);
    },
    (err) => reportListenerError(err, OperationType.LIST, path, onError)
  );
}

export async function toggleStatusReaction(params: {
  statusId: string;
  user: UserPublicProfile;
  emoji: StatusReactionEmoji;
  currentEmoji?: StatusReactionEmoji | null;
}): Promise<void> {
  const ref = doc(db, 'statuses', params.statusId, 'reactions', params.user.uid);
  const path = `statuses/${params.statusId}/reactions/${params.user.uid}`;
  try {
    if (params.currentEmoji === params.emoji) {
      await deleteDoc(ref);
    } else {
      await setDoc(ref, {
        statusId: params.statusId,
        uid: params.user.uid,
        displayName: sanitizeStr(params.user.displayName, LIMITS.DISPLAY_NAME_MAX) || 'User',
        photoUrl: sanitizeStr(params.user.photoUrl || '', LIMITS.PHOTO_URL_MAX),
        emoji: params.emoji,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export function subscribeStatusComments(
  statusId: string,
  onComments: (comments: StatusComment[]) => void,
  onError?: (friendlyMessage: string) => void
): Unsubscribe {
  const path = `statuses/${statusId}/comments`;
  const q = query(
    collection(db, 'statuses', statusId, 'comments'),
    where('statusId', '==', statusId)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs
        .map((d) => ({
          id: d.id,
          ...(d.data() as Omit<StatusComment, 'id'>),
        }))
        .sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
      onComments(list);
    },
    (err) => reportListenerError(err, OperationType.LIST, path, onError)
  );
}

export async function addStatusComment(params: {
  statusId: string;
  user: UserPublicProfile;
  text: string;
}): Promise<void> {
  const cleanText = sanitizeStr(params.text, LIMITS.STATUS_TEXT_MAX);
  if (!cleanText) return;
  const ref = doc(collection(db, 'statuses', params.statusId, 'comments'));
  const path = `statuses/${params.statusId}/comments/${ref.id}`;
  try {
    await setDoc(ref, {
      id: ref.id,
      statusId: params.statusId,
      uid: params.user.uid,
      displayName: sanitizeStr(params.user.displayName, LIMITS.DISPLAY_NAME_MAX) || 'User',
      photoUrl: sanitizeStr(params.user.photoUrl || '', LIMITS.PHOTO_URL_MAX),
      text: cleanText,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function deleteStatusComment(params: {
  statusId: string;
  commentId: string;
}): Promise<void> {
  const path = `statuses/${params.statusId}/comments/${params.commentId}`;
  try {
    await deleteDoc(doc(db, 'statuses', params.statusId, 'comments', params.commentId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

const STATUS_LIFETIME_MS = 24 * 60 * 60 * 1000;

export function subscribeStatusesForUids(
  uids: string[],
  onStatuses: (statuses: UserStatus[]) => void
): Unsubscribe {
  const uniqueUids = Array.from(new Set(uids.filter((id) => Boolean(id) && LIMITS.ID_PATTERN.test(id))));
  if (uniqueUids.length === 0) {
    onStatuses([]);
    return () => {};
  }

  const batches: string[][] = [];
  for (let i = 0; i < uniqueUids.length; i += 10) {
    batches.push(uniqueUids.slice(i, i + 10));
  }

  const bucketMap = new Map<number, UserStatus[]>();
  const unsubs: Unsubscribe[] = [];

  const emit = () => {
    const now = Date.now();
    const merged: UserStatus[] = [];
    bucketMap.forEach((arr) => merged.push(...arr));
    const active = merged
      .filter((s) => {
        const createdMs = s.createdAt?.toMillis?.();
        const explicitExpiryMs = s.expiresAt?.toMillis?.();
        const effectiveExpiryMs = Math.max(
          explicitExpiryMs ?? 0,
          createdMs ? createdMs + STATUS_LIFETIME_MS : now + STATUS_LIFETIME_MS
        );
        return effectiveExpiryMs > now;
      })
      .sort((a, b) => (b.createdAt?.toMillis?.() ?? Date.now()) - (a.createdAt?.toMillis?.() ?? Date.now()));
    onStatuses(active);
  };

  batches.forEach((uidBatch, idx) => {
    const q = query(collection(db, 'statuses'), where('uid', 'in', uidBatch));
    const unsub = onSnapshot(
      q,
      (snap) => {
        bucketMap.set(
          idx,
          snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<UserStatus, 'id'>),
          }))
        );
        emit();
      },
      (err) => {
        console.warn('[KothaLink] Status subscription warning:', err?.message || err);
      }
    );
    unsubs.push(unsub);
  });

  // Re-evaluate expiry every 60s so expired >24h statuses disappear accurately without early cutoff
  const expiryTimer = window.setInterval(emit, 60_000);

  return () => {
    window.clearInterval(expiryTimer);
    unsubs.forEach((u) => u());
  };
}
