/**
 * Shared API DTOs — keep these in sync with Server/routes/*.
 */

export type Room = {
  id: string;
  name: string;
  description: string;
};

export type Author = {
  uid: string;
  handle?: string | null;
  displayName: string;
  colorHex: string;
};

export type ReactionType = 'like' | 'shake' | null;

export type PollOption = {
  id: string;
  label: string;
  voteCount: number;
};

export type Poll = {
  id: string;
  postId: string;
  question: string;
  options: PollOption[];
  myVote?: string | null;
  totalVotes: number;
  createdAt: string;
};

export type Post = {
  id: string;
  roomId: string;
  text: string;
  createdAt: string;
  likeCount: number;
  shakeCount: number;
  commentCount: number;
  myReaction: ReactionType;
  author: Author;
  photoUrl?: string | null;
  isAdminPost?: boolean;
  pinnedAt?: string | null;
  poll?: Poll | null;
};

export type Comment = {
  id: string;
  text: string;
  createdAt: string;
  likeCount: number;
  shakeCount: number;
  myReaction: ReactionType;
  author: Author;
};

// ---- Coins ----

export type CoinTx = {
  at: string;
  delta: number;
  reason: string;
};

export type CoinCosts = {
  open_feed: number;
  open_dms: number;
  open_arena: number;
  post_feed: number;
  post_arena: number;
  ad_reward: number;
};

export type CoinBalance = {
  balance: number;
  adsWatchedToday: number;
  lastResetAt: string;
  spentToday: Record<string, number>;
  history: CoinTx[];
  costs: CoinCosts;
};

// ---- Arena ----

export type Party = {
  id: string;
  label: string;
  emoji: string;
  colorHex?: string;
};

export type ArenaTopic = {
  id: string;
  title: string;
  description: string;
  parties: Party[];
  postsByParty: Record<string, number>;
  createdByDid: string;
  createdAt: string;
  expiresAt: string;
};

export type ArenaPost = {
  id: string;
  topicId: string;
  partyId: string;
  parentId?: string | null;
  text: string;
  createdAt: string;
  author: Author;
};

// ---- Admin ----

export type AdminDevice = {
  did: string;
  isAdmin: boolean;
  createdAt: string;
  lastActiveAt: string;
  handle: string | null;
  displayName: string | null;
  colorHex: string | null;
  createdByAdminDid: string | null;
};

export type AdminPostPayload = {
  text: string;
  pinned?: boolean;
  photoUrl?: string;
  poll?: { question: string; options: { label: string }[] };
};

export type AdminCreatedUser = {
  did: string;
  uid: string;
  handle: string;
  displayName: string;
  colorHex: string;
  password: string;
  accessToken: string;
  expiresAt: string;
};

export type AdminAccount = {
  uid: string;
  did: string;
  handle: string | null;
  displayName: string;
  colorHex: string;
  expiresAt: string;
};

// ---- Profile & Social ----

export type UserProfile = {
  uid: string;
  did?: string;
  handle: string;
  displayName: string;
  colorHex: string;
  expiresAt?: string;
  followersCount?: number;
  followingCount?: number;
  isFollowing?: boolean;
};

export type ProfileResponse = {
  profile: UserProfile;
  stats: {
    postCount: number;
    lifetimeLikes: number;
    lifetimeShakes: number;
    lifetimeComments: number;
    commentCount: number;
    conversationCount: number;
    followersCount?: number;
    followingCount?: number;
  };
  posts: Array<{
    id: string;
    text: string;
    createdAt: string;
    likeCount: number;
    shakeCount: number;
    commentCount: number;
  }>;
};