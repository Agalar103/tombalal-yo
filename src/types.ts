
export interface Player {
  id: string; // socket id
  userId: string; // persistent unique id
  name: string;
  photo: string;
  card: number[][];
  checkedNumbers: number[];
  isReady: boolean;
  score: number;
  wins: number;
  losses: number;
  isKing: boolean;
  isBot?: boolean;
}

export type ServerType = 'local' | 'aws' | 'clf';

export interface Room {
  id: string;
  password?: string;
  players: Player[];
  status: 'waiting' | 'playing' | 'finished';
  drawnNumbers: number[];
  currentNumber: number | null;
  winner: Player | null;
  lastAnnouncement: string;
  bannedUserIds: string[];
  nextNumberAt?: number;
  seed: string;
  isThinking?: boolean;
  serverType?: ServerType;
}
// ... rest of types remain same

export interface LeaderboardEntry {
  userId: string;
  name: string;
  photo: string;
  wins: number;
  losses: number;
}

export interface ServerToClientEvents {
  roomUpdated: (room: Room) => void;
  gameStarted: (room: Room) => void;
  numberDrawn: (number: number, announcement: string) => void;
  gameOver: (winner: Player) => void;
  error: (message: string) => void;
  leaderboardUpdated: (entries: LeaderboardEntry[]) => void;
  kicked: () => void;
  emojiReceived: (from: string, emoji: string) => void;
  userAuthenticated: (userData: { userId: string, name: string, photo: string, wins: number, losses: number }) => void;
}

export interface ClientToServerEvents {
  authenticate: (userId?: string, name?: string, photo?: string) => void;
  createRoom: (password: string, serverType: ServerType) => void;
  joinRoom: (roomId: string, password?: string) => void;
  ready: (roomId: string) => void;
  checkNumber: (roomId: string, number: number) => void;
  bingo: (roomId: string) => void;
  kickPlayer: (roomId: string, targetPlayerId: string) => void;
  sendEmoji: (roomId: string, targetPlayerId: string, emoji: string) => void;
  leaveRoom: (roomId: string) => void;
  addBots: (roomId: string) => void;
  getLeaderboard: () => void;
  updateProfile: (name: string, photo: string) => void;
}
