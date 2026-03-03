import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'motion/react';
import { 
  User, Users, Play, Plus, LogIn, Trophy, AlertCircle, 
  CheckCircle2, Camera, Eye, EyeOff, Crown, UserMinus, 
  Library, ChevronRight, LayoutDashboard, X, Volume2, VolumeX,
  LogOut, ArrowLeft, Bot
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { Room, Player, ServerToClientEvents, ClientToServerEvents, LeaderboardEntry } from './types';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const SOCKET_URL = window.location.origin;

// Audio URLs
const SFX = {
  click: 'https://assets.mixkit.co/sfx/preview/mixkit-click-release-1006.mp3',
  win: 'https://assets.mixkit.co/sfx/preview/mixkit-winning-chimes-2015.mp3',
  lose: 'https://assets.mixkit.co/sfx/preview/mixkit-sad-game-over-trombone-471.mp3',
  draw: 'https://assets.mixkit.co/sfx/preview/mixkit-modern-technology-select-3124.mp3'
};

const BGM_URL = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3'; // Chill music

export default function App() {
  const [socket, setSocket] = useState<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const [user, setUser] = useState<{ userId: string, name: string, photo: string, wins: number, losses: number } | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'auth' | 'library' | 'room_actions' | 'lobby' | 'game' | 'winner'>('auth');
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isGlitching, setIsGlitching] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [showBotPrompt, setShowBotPrompt] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [notifications, setNotifications] = useState<{ id: string, message: string, type: 'info' | 'emoji' }[]>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, playerId: string } | null>([]);

  const bgmRef = useRef<HTMLAudioElement | null>(null);

  const playSFX = useCallback((key: keyof typeof SFX) => {
    if (isMuted) return;
    const audio = new Audio(SFX[key]);
    audio.volume = 0.4;
    audio.play().catch(() => {});
  }, [isMuted]);

  useEffect(() => {
    const newSocket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SOCKET_URL);
    setSocket(newSocket);

    const savedUserId = localStorage.getItem('tombalaliyo_userId');
    const savedName = localStorage.getItem('tombalaliyo_name');
    const savedPhoto = localStorage.getItem('tombalaliyo_photo');

    if (savedUserId) {
      newSocket.emit('authenticate', savedUserId, savedName || undefined, savedPhoto || undefined);
    }

    newSocket.on('userAuthenticated', (userData) => {
      setUser(userData);
      localStorage.setItem('tombalaliyo_userId', userData.userId);
      localStorage.setItem('tombalaliyo_name', userData.name);
      localStorage.setItem('tombalaliyo_photo', userData.photo);
      if (view === 'auth') triggerTransition('library');
    });

    newSocket.on('roomUpdated', (updatedRoom) => {
      setRoom(updatedRoom);
      if (updatedRoom.status === 'playing' && view !== 'game') triggerTransition('game');
      else if (updatedRoom.status === 'waiting' && view !== 'lobby') triggerTransition('lobby');
      else if (updatedRoom.status === 'finished' && view !== 'winner') triggerTransition('winner');
      
      if (updatedRoom.nextNumberAt) {
        const remaining = Math.max(0, Math.floor((updatedRoom.nextNumberAt - Date.now()) / 1000));
        setTimeLeft(remaining);
      } else {
        setTimeLeft(null);
      }
    });

    newSocket.on('numberDrawn', (num) => {
      playSFX('draw');
      // Google TTS (SpeechSynthesis)
      if (!isMuted) {
        const msg = new SpeechSynthesisUtterance(`${num} numara`);
        msg.lang = 'tr-TR';
        msg.rate = 1.1;
        window.speechSynthesis.speak(msg);
      }
    });

    newSocket.on('gameOver', (winner) => {
      if (winner.id === newSocket.id) playSFX('win');
      else playSFX('lose');
    });

    newSocket.on('leaderboardUpdated', (entries) => {
      setLeaderboard(entries);
    });

    newSocket.on('kicked', () => {
      setRoom(null);
      triggerTransition('library');
      addNotification("Odadan atıldınız!", 'info');
      playSFX('lose');
    });

    newSocket.on('emojiReceived', (from, emoji) => {
      addNotification(`${from} size bir emoji gönderdi: ${emoji}`, 'emoji');
      playSFX('click');
    });

    newSocket.on('error', (msg) => {
      setError(msg);
      setTimeout(() => setError(null), 3000);
    });

    return () => {
      newSocket.disconnect();
    };
  }, [playSFX]);

  useEffect(() => {
    if (!bgmRef.current) {
      bgmRef.current = new Audio(BGM_URL);
      bgmRef.current.loop = true;
      bgmRef.current.volume = 0.02; // Updated to 2%
    }
    
    if (!isMuted && view !== 'auth') {
      bgmRef.current.play().catch(() => {});
    } else {
      bgmRef.current.pause();
    }
  }, [isMuted, view]);

  useEffect(() => {
    if (timeLeft === null || timeLeft <= 0) return;
    const timer = setInterval(() => {
      setTimeLeft(prev => (prev !== null && prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [timeLeft]);

  const addNotification = (message: string, type: 'info' | 'emoji' = 'info') => {
    const id = Math.random().toString(36).substring(7);
    setNotifications(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000);
  };

  const triggerTransition = (nextView: typeof view) => {
    setIsGlitching(true);
    setView(nextView);
    setTimeout(() => setIsGlitching(false), 150);
  };

  const handleAuth = (name: string, photo: string, userId?: string) => {
    playSFX('click');
    socket?.emit('authenticate', userId, name, photo);
  };

  const handleCreateRoom = (password: string) => {
    if (!user) {
      setError("Lütfen önce giriş yapın!");
      return;
    }
    playSFX('click');
    socket?.emit('createRoom', password);
  };

  const handleJoinRoom = (id: string, password?: string) => {
    playSFX('click');
    socket?.emit('joinRoom', id, password);
  };

  const handleReady = () => {
    playSFX('click');
    if (room) socket?.emit('ready', room.id);
  };

  const handleCheckNumber = (num: number) => {
    playSFX('click');
    if (room) socket?.emit('checkNumber', room.id, num);
  };

  const handleBingo = () => {
    playSFX('win'); // Play win music immediately as requested
    if (room) socket?.emit('bingo', room.id);
  };

  const handleKick = (playerId: string) => {
    playSFX('click');
    if (room) socket?.emit('kickPlayer', room.id, playerId);
  };

  const handleLeaveRoom = () => {
    playSFX('click');
    if (room) {
      socket?.emit('leaveRoom', room.id);
      setRoom(null);
      triggerTransition('library');
      setShowExitConfirm(false);
    }
  };

  const handleAddBots = () => {
    playSFX('click');
    if (room) {
      socket?.emit('addBots', room.id);
      setShowBotPrompt(false);
    }
  };

  const handleUpdateProfile = (name: string, photo: string) => {
    playSFX('click');
    socket?.emit('updateProfile', name, photo);
    setShowEditProfile(false);
  };

  const handleSendEmoji = (targetPlayerId: string, emoji: string) => {
    if (room) socket?.emit('sendEmoji', room.id, targetPlayerId, emoji);
  };

  return (
    <div 
      className={cn(
        "min-h-screen w-full flex flex-col items-center justify-center p-4 overflow-hidden relative cyber-grid", 
        isGlitching && "glitch-active"
      )}
      onClick={() => setContextMenu(null)}
    >
      <div className="glitch-overlay" />
      
      {/* Interface Scale Wrapper */}
      <div className="w-full h-full flex flex-col items-center justify-center scale-[0.9] origin-center transition-transform duration-500">
      <div className="fixed top-20 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {notifications.map(n => (
            <motion.div
              key={n.id}
              initial={{ opacity: 0, x: 50, scale: 0.8 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 50, scale: 0.8 }}
              className={cn(
                "px-4 py-2 rounded-lg border-2 shadow-2xl font-bold uppercase text-xs flex items-center gap-2 pointer-events-auto",
                n.type === 'emoji' ? "bg-punk-cyan border-white text-black" : "bg-punk-purple border-punk-neon text-white"
              )}
            >
              <AlertCircle className="w-4 h-4" />
              {n.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Context Menu */}
      <AnimatePresence>
        {contextMenu && room && room.players.find(p => p.id === socket?.id)?.isKing && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            style={{ left: contextMenu.x, top: contextMenu.y }}
            className="fixed z-[200] bg-black border-2 border-punk-neon p-2 flex flex-col gap-1 shadow-[0_0_20px_rgba(255,0,255,0.5)]"
          >
            <button 
              onClick={() => {
                handleKick(contextMenu.playerId);
                setContextMenu(null);
              }}
              className="px-4 py-2 hover:bg-red-600 text-white font-black uppercase text-[10px] flex items-center gap-2"
            >
              <UserMinus className="w-3 h-3" /> Odadan At
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="popLayout">
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -50 }}
            className="fixed top-4 z-50 bg-red-600 border-2 border-white px-6 py-3 flex items-center gap-2 skew-x-[-10deg] shadow-[4px_4px_0px_black]"
          >
            <AlertCircle className="w-5 h-5" />
            <span className="font-bold uppercase tracking-tighter">{error}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Exit Confirmation Modal */}
      <AnimatePresence>
        {showExitConfirm && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <div className="punk-card p-8 max-w-sm w-full text-center">
              <h3 className="text-2xl font-black uppercase italic mb-4">Odadan çıkmak istiyor musun?</h3>
              <div className="flex gap-4">
                <button onClick={handleLeaveRoom} className="punk-button flex-1 bg-red-600 border-red-400">EVET</button>
                <button onClick={() => setShowExitConfirm(false)} className="punk-button flex-1">HAYIR</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bot Prompt Modal */}
      <AnimatePresence>
        {showBotPrompt && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <div className="punk-card p-8 max-w-sm w-full text-center">
              <Bot className="w-16 h-16 text-punk-cyan mx-auto mb-4 animate-bounce" />
              <h3 className="text-2xl font-black uppercase italic mb-4">Yapay zeka ile oynamak ister misin?</h3>
              <p className="text-xs opacity-50 uppercase font-bold mb-6">Oda boş slotlar botlarla doldurulacaktır.</p>
              <div className="flex gap-4">
                <button onClick={handleAddBots} className="punk-button flex-1 bg-punk-cyan border-punk-cyan text-black">EVET</button>
                <button onClick={() => setShowBotPrompt(false)} className="punk-button flex-1">HAYIR</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Leaderboard Modal */}
      <AnimatePresence>
        {showLeaderboard && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }}
              className="punk-card w-full max-w-2xl p-8 relative"
            >
              <button onClick={() => setShowLeaderboard(false)} className="absolute top-4 right-4 text-white/50 hover:text-white">
                <X className="w-8 h-8" />
              </button>
              <h2 className="text-4xl font-black uppercase italic glitch-text mb-8">Liderlik Tablosu</h2>
              <div className="flex flex-col gap-4 max-h-[60vh] overflow-y-auto pr-2">
                {leaderboard.map((entry, idx) => (
                  <div key={entry.userId} className="flex items-center gap-4 p-4 bg-white/5 border-l-4 border-punk-neon">
                    <span className="text-2xl font-black italic opacity-30 w-8">#{idx + 1}</span>
                    <img src={entry.photo} className="w-12 h-12 bg-black border border-punk-purple object-cover" />
                    <div className="flex-1">
                      <p className="font-black uppercase">{entry.name}</p>
                      <p className="text-[10px] opacity-50 font-bold">ID: {entry.userId}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-punk-neon font-black italic">{entry.wins} GALİBİYET</p>
                      <p className="text-[10px] font-bold opacity-50">{entry.losses} MAĞLUBİYET</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Profile Modal */}
      <AnimatePresence>
        {showEditProfile && user && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-black/95 backdrop-blur-md flex items-center justify-center p-4"
          >
            <div className="punk-card p-8 max-w-md w-full relative">
              <button onClick={() => setShowEditProfile(false)} className="absolute top-4 right-4 text-white/50 hover:text-white">
                <X className="w-8 h-8" />
              </button>
              <h3 className="text-3xl font-black uppercase italic mb-8 border-b-4 border-punk-neon pb-2">Profili Düzenle</h3>
              <EditProfileForm user={user} onUpdate={handleUpdateProfile} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <header className="mb-8 text-center">
        <motion.h1 
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-6xl md:text-8xl font-black italic tracking-tighter glitch-text uppercase cursor-pointer"
          onClick={() => {
            playSFX('click');
            if (view !== 'auth') triggerTransition('library');
          }}
        >
          Tombalalıyo
        </motion.h1>
        <div className="flex items-center justify-center gap-4 mt-2">
          <p className="text-punk-neon font-bold tracking-[0.5em] uppercase text-xs">Punk Edition // 2026</p>
          {user && (
            <button 
              onClick={() => {
                playSFX('click');
                setShowLeaderboard(true);
              }}
              className="flex items-center gap-1 text-[10px] font-black uppercase text-punk-cyan hover:underline"
            >
              <LayoutDashboard className="w-3 h-3" />
              Sıralama
            </button>
          )}
        </div>
      </header>

      <main className="w-full max-w-4xl relative">
        {/* Navigation Buttons */}
        {view !== 'auth' && view !== 'library' && view !== 'game' && view !== 'winner' && (
          <div className="absolute -top-12 left-0 flex gap-4">
            <button 
              onClick={() => {
                playSFX('click');
                if (view === 'room_actions') triggerTransition('library');
                else if (view === 'lobby') setShowExitConfirm(true);
              }}
              className="flex items-center gap-1 text-xs font-black uppercase text-white/50 hover:text-punk-neon"
            >
              <ArrowLeft className="w-4 h-4" /> Geri
            </button>
          </div>
        )}

        <AnimatePresence mode="popLayout">
          {view === 'auth' && (
            <AuthView onAuth={handleAuth} />
          )}

          {view === 'library' && user && (
            <LibraryView 
              user={user} 
              onSelect={() => triggerTransition('room_actions')} 
              onEdit={() => setShowEditProfile(true)}
            />
          )}

          {view === 'room_actions' && (
            <RoomActionsView 
              onCreate={handleCreateRoom} 
              onJoin={handleJoinRoom} 
              onBack={() => triggerTransition('library')}
            />
          )}

          {view === 'lobby' && room && (
            <LobbyView 
              room={room} 
              onReady={handleReady} 
              onKick={handleKick}
              onLeave={() => setShowExitConfirm(true)}
              onAddBots={() => setShowBotPrompt(true)}
              playerId={socket?.id || ''}
            />
          )}

          {view === 'game' && room && (
            <GameView 
              room={room} 
              onCheck={handleCheckNumber}
              onBingo={handleBingo}
              onLeave={() => setShowExitConfirm(true)}
              playerId={socket?.id || ''}
              timeLeft={timeLeft}
              onSendEmoji={handleSendEmoji}
              onKick={handleKick}
              setContextMenu={setContextMenu}
            />
          )}

          {view === 'winner' && room && (
            <WinnerView 
              room={room} 
              onNewGame={() => triggerTransition('library')}
            />
          )}
        </AnimatePresence>
      </main>

        {/* Mute Button */}
        <button 
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsMuted(!isMuted);
          }}
          className="fixed bottom-4 right-4 p-4 bg-punk-purple/50 border-2 border-punk-neon text-white hover:bg-punk-neon hover:text-black transition-all z-[100]"
        >
          {isMuted ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
        </button>
      </div>
    </div>
  );
}

function EditProfileForm({ user, onUpdate }: { user: any, onUpdate: (name: string, photo: string) => void }) {
  const [name, setName] = useState(user.name);
  const [photo, setPhoto] = useState(user.photo);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 20 * 1024 * 1024) {
        alert("Dosya boyutu 20MB'dan küçük olmalıdır!");
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setPhoto(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="relative group mx-auto">
        <img src={photo} className="w-32 h-32 bg-black border-4 border-punk-purple group-hover:border-punk-neon transition-colors object-cover" />
        <button 
          onClick={() => fileInputRef.current?.click()}
          className="absolute -bottom-2 -right-2 p-3 bg-punk-neon text-black hover:scale-110 transition-transform"
        >
          <Camera className="w-5 h-5" />
        </button>
        <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/png,image/jpeg,image/gif" />
      </div>

      <div className="flex flex-col gap-4">
        <input 
          type="text" placeholder="İSİM GİRİNİZ..." 
          value={name} onChange={(e) => setName(e.target.value)}
          className="punk-input w-full text-center text-xl font-bold uppercase"
        />
        <button 
          onClick={() => onUpdate(name, photo)}
          className="punk-button w-full text-xl py-4"
        >
          GÜNCELLE
        </button>
      </div>
    </div>
  );
}

function AuthView({ onAuth }: { onAuth: (name: string, photo: string, userId?: string) => void }) {
  const [name, setName] = useState(localStorage.getItem('tombalaliyo_name') || '');
  const [photo, setPhoto] = useState(localStorage.getItem('tombalaliyo_photo') || `https://api.dicebear.com/7.x/avataaars/svg?seed=punk`);
  const [userId, setUserId] = useState('');
  const [showIdInput, setShowIdInput] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 20 * 1024 * 1024) {
        alert("Dosya boyutu 20MB'dan küçük olmalıdır!");
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setPhoto(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
      className="punk-card p-12 flex flex-col items-center gap-8 max-w-md mx-auto"
    >
      <h2 className="text-3xl font-black uppercase italic border-b-4 border-punk-neon pb-2 w-full text-center">Giriş Yap</h2>
      
      <div className="relative group">
        <img src={photo} className="w-32 h-32 bg-black border-4 border-punk-purple group-hover:border-punk-neon transition-colors object-cover" />
        <button 
          onClick={() => fileInputRef.current?.click()}
          className="absolute -bottom-2 -right-2 p-3 bg-punk-neon text-black hover:scale-110 transition-transform"
        >
          <Camera className="w-5 h-5" />
        </button>
        <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/png,image/jpeg,image/gif" />
      </div>

      <div className="w-full flex flex-col gap-4">
        <input 
          type="text" placeholder="İSİM GİRİNİZ..." 
          value={name} onChange={(e) => setName(e.target.value)}
          className="punk-input w-full text-center text-xl font-bold uppercase"
        />

        <div className="flex flex-col gap-2">
          <button 
            onClick={() => setShowIdInput(!showIdInput)}
            className="text-[10px] font-black uppercase text-punk-cyan hover:underline self-end"
          >
            {showIdInput ? "İptal" : "Özel ID ile Giriş"}
          </button>
          {showIdInput && (
            <input 
              type="text" placeholder="ÖZEL ID GİRİNİZ..." 
              value={userId} onChange={(e) => setUserId(e.target.value)}
              className="punk-input w-full text-center text-sm font-bold"
            />
          )}
        </div>

        <button 
          onClick={() => onAuth(name, photo, userId || undefined)}
          className="punk-button w-full text-2xl py-4 mt-4"
        >
          BAŞLA
        </button>
      </div>
    </motion.div>
  );
}

function LibraryView({ user, onSelect, onEdit }: { user: any, onSelect: () => void, onEdit: () => void }) {
  const [showId, setShowId] = useState(false);

  const getBadge = (name: string) => {
    if (name === "Hasan Delibaş") return <CheckCircle2 className="w-4 h-4 text-blue-500 fill-white" />;
    if (name === "Asi103") return <CheckCircle2 className="w-4 h-4 text-red-500 fill-white" />;
    return null;
  };

  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
      className="grid md:grid-cols-[350px_1fr] gap-12 w-full max-w-6xl"
    >
      <div className="punk-card p-10 flex flex-col items-center gap-8 h-fit shadow-[0_0_30px_rgba(255,0,255,0.2)]">
        <div className="relative">
          <img src={user.photo} className="w-40 h-40 bg-black border-4 border-punk-purple object-cover" />
          <div className="absolute -bottom-2 -right-2">
            {getBadge(user.name)}
          </div>
        </div>
        <div className="text-center w-full">
          <h2 className="text-3xl font-black uppercase italic truncate flex items-center justify-center gap-2">
            {user.name}
            {getBadge(user.name)}
          </h2>
          <div className="flex items-center justify-center gap-2 mt-2">
            <p className="text-xs font-bold opacity-50 uppercase">Özel ID: {showId ? user.userId : "••••••••••••"}</p>
            <button onClick={() => setShowId(!showId)} className="text-punk-cyan">
              {showId ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
        
        <button 
          onClick={onEdit}
          className="punk-button w-full text-sm py-3 bg-punk-purple/20 border-punk-purple hover:bg-punk-purple/40"
        >
          PROFİLİ DÜZENLE
        </button>

        <div className="grid grid-cols-2 gap-8 w-full pt-6 border-t border-white/10">
          <div className="text-center">
            <p className="text-punk-neon font-black text-3xl">{user.wins}</p>
            <p className="text-xs font-bold uppercase opacity-50">Galibiyet</p>
          </div>
          <div className="text-center">
            <p className="text-white font-black text-3xl">{user.losses}</p>
            <p className="text-xs font-bold uppercase opacity-50">Mağlubiyet</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-8">
        <h2 className="text-5xl font-black uppercase italic flex items-center gap-4">
          <Library className="w-12 h-12 text-punk-neon" />
          Kütüphane
        </h2>
        
        <div 
          onClick={onSelect}
          className="punk-card p-12 group cursor-pointer border-punk-purple hover:border-punk-neon transition-all relative overflow-hidden shadow-[0_0_50px_rgba(0,255,255,0.1)]"
        >
          <div className="absolute top-0 right-0 p-6 bg-punk-neon text-black font-black uppercase text-sm skew-x-[-10deg] translate-x-4">Aktif</div>
          <div className="flex items-center gap-12">
            <div className="w-32 h-32 bg-punk-purple/20 flex items-center justify-center border-4 border-punk-purple group-hover:border-punk-neon transition-all">
              <Play className="w-16 h-16 text-punk-neon group-hover:scale-110 transition-transform" />
            </div>
            <div className="flex-1">
              <h3 className="text-5xl font-black uppercase italic mb-3 group-hover:text-punk-neon transition-colors">Tombala</h3>
              <p className="text-lg opacity-60 uppercase font-bold leading-tight">
                Punk tarzında klasik tombala deneyimi. <br/>
                AI sunucu eşliğinde 4-8 oyuncu ile gerçek zamanlı rekabet.
              </p>
            </div>
            <ChevronRight className="w-16 h-16 opacity-20 group-hover:opacity-100 transition-all group-hover:translate-x-2" />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function RoomActionsView({ onCreate, onJoin, onBack }: { onCreate: (p: string, s: any) => void, onJoin: (id: string, p?: string) => void, onBack: () => void }) {
  const [roomId, setRoomId] = useState('');
  const [password, setPassword] = useState('');
  const [serverType, setServerType] = useState<'local' | 'aws' | 'clf'>('local');

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.1 }}
      className="grid md:grid-cols-2 gap-8 w-full max-w-5xl"
    >
      <div className="punk-card p-8 flex flex-col gap-6">
        <h2 className="text-3xl font-black uppercase italic border-b-4 border-punk-cyan pb-2">Oda Oluştur</h2>
        <div className="flex flex-col gap-4">
          <p className="text-sm opacity-60 uppercase font-bold">Odanız için bir şifre belirleyin (isteğe bağlı).</p>
          <input 
            type="password" placeholder="ODA ŞİFRESİ" 
            value={password} onChange={(e) => setPassword(e.target.value)}
            className="punk-input w-full text-center font-bold"
          />
          
          <div className="flex flex-col gap-2">
            <p className="text-[10px] font-black uppercase text-punk-cyan">Sunucu Altyapısı:</p>
            <div className="grid grid-cols-3 gap-2">
              <button 
                onClick={() => setServerType('local')}
                className={cn("punk-button text-[8px] py-2 px-1", serverType === 'local' ? "bg-punk-cyan text-black" : "opacity-40")}
              >
                YEREL (PC)
              </button>
              <button 
                onClick={() => setServerType('aws')}
                className={cn("punk-button text-[8px] py-2 px-1", serverType === 'aws' ? "bg-punk-cyan text-black" : "opacity-40")}
              >
                AWS (AMAZON)
              </button>
              <button 
                onClick={() => setServerType('clf')}
                className={cn("punk-button text-[8px] py-2 px-1", serverType === 'clf' ? "bg-punk-cyan text-black" : "opacity-40")}
              >
                CLF (CLOUDFLARE)
              </button>
            </div>
          </div>

          <button onClick={() => onCreate(password, serverType)} className="punk-button w-full flex items-center justify-center gap-2 py-4 mt-2">
            <Plus className="w-6 h-6" />
            OLUŞTUR
          </button>
        </div>
      </div>

      <div className="punk-card p-8 flex flex-col gap-6">
        <h2 className="text-3xl font-black uppercase italic border-b-4 border-punk-yellow pb-2">Odaya Katıl</h2>
        <div className="flex flex-col gap-4">
          <input 
            type="text" placeholder="ODA KODU" 
            value={roomId} onChange={(e) => setRoomId(e.target.value.toUpperCase())}
            className="punk-input w-full text-center font-bold text-2xl"
          />
          <input 
            type="password" placeholder="ŞİFRE (VARSA)" 
            value={password} onChange={(e) => setPassword(e.target.value)}
            className="punk-input w-full text-center font-bold"
          />
          <button onClick={() => onJoin(roomId, password)} className="punk-button w-full flex items-center justify-center gap-2 py-4">
            <LogIn className="w-6 h-6" />
            KATIL
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function LobbyView({ room, onReady, onKick, onLeave, onAddBots, playerId }: { room: Room, onReady: () => void, onKick: (id: string) => void, onLeave: () => void, onAddBots: () => void, playerId: string }) {
  const me = room.players.find(p => p.id === playerId);

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.1 }}
      className="flex flex-col gap-8 w-full max-w-6xl"
    >
      <div className="flex justify-between items-end border-b-4 border-punk-neon pb-4">
        <div>
          <h2 className="text-5xl font-black uppercase italic glitch-text flex items-center gap-4">
            Oda: {room.id}
            {room.password && <span className="text-xs bg-punk-yellow text-black px-3 py-1 not-italic">ŞİFRELİ</span>}
          </h2>
          <p className="text-punk-neon font-bold uppercase text-lg mt-1">Oyuncular bekleniyor (Min 2)</p>
          <div className="flex items-center gap-4 mt-2">
            <p className="text-[10px] opacity-30 font-bold uppercase">Seed: {room.seed}</p>
            <div className="flex items-center gap-2 px-2 py-0.5 bg-black/50 border border-white/10 rounded text-[8px] font-black uppercase opacity-60">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              {room.serverType === 'aws' ? 'AWS CLOUD' : room.serverType === 'clf' ? 'CLOUDFLARE EDGE' : 'LOCAL HOST'}
            </div>
          </div>
        </div>
        <div className="flex gap-6 items-center">
          {me?.isKing && (
            <button onClick={onAddBots} className="punk-button text-sm py-2 px-4 bg-punk-cyan text-black border-punk-cyan hover:scale-105 transition-transform">BOT EKLE</button>
          )}
          <div className="text-right">
            <p className="text-4xl font-black italic text-punk-neon">{room.players.length}/8</p>
            <p className="text-xs opacity-50 uppercase font-bold">Oyuncu Sayısı</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        {room.players.map((player) => (
          <div key={player.id} className={cn("punk-card p-6 flex flex-col items-center gap-4 relative group transition-all hover:scale-105", player.isReady ? "border-punk-neon shadow-[0_0_20px_rgba(255,0,255,0.3)]" : "border-punk-purple")}>
            <div className="relative">
              <img src={player.photo} alt={player.name} className="w-24 h-24 bg-black border-4 border-punk-purple object-cover" />
              <div className="absolute -bottom-2 -right-2">
                <VerificationBadge name={player.name} />
              </div>
              {player.isReady && <CheckCircle2 className="absolute -top-3 -right-3 w-8 h-8 text-punk-neon fill-black" />}
              {player.isKing && <Crown className="absolute -top-8 left-1/2 -translate-x-1/2 w-8 h-8 text-punk-yellow drop-shadow-[0_0_10px_rgba(240,240,0,0.8)]" />}
              {player.isBot && <Bot className="absolute -bottom-2 -left-2 w-6 h-6 text-punk-cyan bg-black rounded-full p-1 border border-punk-cyan" />}
            </div>
            <div className="flex items-center gap-2 w-full justify-center">
              <span className="font-black uppercase text-sm truncate">{player.name}</span>
              <VerificationBadge name={player.name} />
            </div>
            
            {me?.isKing && !player.isKing && (
              <button 
                onClick={() => onKick(player.id)}
                className="absolute top-2 right-2 p-2 bg-red-600 text-white rounded-none hover:bg-red-700 transition-colors opacity-0 group-hover:opacity-100"
                title="Odadan At"
              >
                <UserMinus className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
        {Array.from({ length: 8 - room.players.length }).map((_, i) => (
          <div key={i} className="punk-card p-6 flex flex-col items-center justify-center border-dashed border-white/10 opacity-20">
            <Users className="w-12 h-12 mb-3" />
            <span className="text-xs uppercase font-bold">Boş Slot</span>
          </div>
        ))}
      </div>

      <div className="flex justify-center gap-8 mt-12">
        <button onClick={onLeave} className="punk-button text-3xl px-12 py-6 bg-red-600 border-red-400 hover:scale-110 transition-transform">AYRIL</button>
        <button 
          onClick={onReady} 
          disabled={me?.isReady}
          className={cn("punk-button text-3xl px-16 py-6 transition-all", me?.isReady ? "opacity-50 cursor-not-allowed bg-punk-neon text-black" : "hover:scale-110")}
        >
          {me?.isReady ? "HAZIR!" : "HAZIRIM"}
        </button>
      </div>
    </motion.div>
  );
}

function VerificationBadge({ name }: { name: string }) {
  if (name === "Hasan Delibaş") {
    return <CheckCircle2 className="w-4 h-4 text-blue-400 fill-blue-400/20" title="Doğrulanmış Oyuncu" />;
  }
  if (name === "Asi103") {
    return <CheckCircle2 className="w-4 h-4 text-red-500 fill-red-500/20" title="Özel Oyuncu" />;
  }
  return null;
}

function MiniCard({ card, checkedNumbers }: { card: number[][], checkedNumbers: number[] }) {
  return (
    <div className="grid grid-rows-3 gap-1 bg-black/80 p-1.5 border border-white/20 rounded-md shadow-inner">
      {card.map((row, rIdx) => (
        <div key={rIdx} className="grid grid-cols-9 gap-1">
          {row.map((num, cIdx) => (
            <div 
              key={cIdx} 
              className={cn(
                "w-2.5 h-2.5 rounded-sm transition-all duration-500",
                num === 0 ? "bg-transparent" : checkedNumbers.includes(num) ? "bg-punk-neon shadow-[0_0_10px_#ff00ff]" : "bg-white/10"
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function GameView({ room, onCheck, onBingo, onLeave, playerId, timeLeft, onSendEmoji, onKick, setContextMenu }: { room: Room, onCheck: (n: number) => void, onBingo: () => void, onLeave: () => void, playerId: string, timeLeft: number | null, onSendEmoji: (id: string, e: string) => void, onKick: (id: string) => void, setContextMenu: (ctx: any) => void }) {
  const me = room.players.find(p => p.id === playerId);
  if (!me) return null;

  const others = room.players.filter(p => p.id !== playerId);
  const cardNumbers = me.card.flat().filter(n => n !== 0);
  const hasBingo = cardNumbers.every(n => me.checkedNumbers.includes(n));

  const cardRef = useRef<HTMLDivElement>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState<string | null>(null);

  const emojis = ["😂", "🔥", "🤡", "👑", "💀", "🤔", "😎", "😡", "😭", "😮"];

  const handleContextMenu = (e: React.MouseEvent, targetPlayerId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, playerId: targetPlayerId });
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="grid grid-cols-[320px_1fr_320px] gap-8 w-screen h-[85vh] max-w-[1800px] px-8 items-stretch"
    >
      {/* Left Zone: Other Players (Green Area) */}
      <div className="punk-card border-green-500/30 p-6 flex flex-col gap-6 overflow-hidden bg-green-500/5 shadow-[inset_0_0_50px_rgba(34,197,94,0.05)]">
        <h3 className="text-green-500 font-black uppercase italic text-sm border-b-2 border-green-500/20 pb-2 tracking-widest">OYUNCULAR</h3>
        <div className="flex-1 overflow-y-auto pr-2 flex flex-col gap-4 custom-scrollbar">
          {others.map((player) => (
            <div 
              key={player.id} 
              className={cn(
                "punk-card p-4 flex flex-col gap-3 relative group transition-all hover:bg-white/5",
                player.checkedNumbers.length >= 10 ? "border-punk-neon" : "border-white/10"
              )}
              onContextMenu={(e) => handleContextMenu(e, player.id)}
            >
              <div className="flex items-center gap-4">
                <div className="relative">
                  <img src={player.photo} className="w-12 h-12 bg-black border-2 border-white/20 object-cover rounded-sm" />
                  {player.isKing && <Crown className="absolute -top-4 left-1/2 -translate-x-1/2 w-5 h-5 text-punk-yellow drop-shadow-[0_0_5px_rgba(240,240,0,0.5)]" />}
                  {player.isBot && <Bot className="absolute -bottom-2 -left-2 w-5 h-5 text-punk-cyan" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <p className="font-black uppercase text-xs truncate text-white">{player.name}</p>
                    <VerificationBadge name={player.name} />
                  </div>
                  <div className="w-full bg-white/5 h-1.5 mt-2 rounded-full overflow-hidden">
                    <motion.div 
                      className="bg-punk-neon h-full shadow-[0_0_10px_#ff00ff]" 
                      initial={{ width: 0 }}
                      animate={{ width: `${(player.checkedNumbers.length / 15) * 100}%` }}
                    />
                  </div>
                </div>
                <span className="text-[10px] font-black text-punk-neon">{player.checkedNumbers.length}/15</span>
              </div>
              
              <button 
                onClick={() => setShowEmojiPicker(showEmojiPicker === player.id ? null : player.id)}
                className="w-full py-1.5 bg-punk-cyan/10 border border-punk-cyan/30 text-punk-cyan font-black uppercase text-[10px] hover:bg-punk-cyan hover:text-black transition-all tracking-tighter"
              >
                EMOJI GÖNDER
              </button>

              <AnimatePresence>
                {showEmojiPicker === player.id && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                    className="absolute top-full left-0 right-0 z-50 bg-black border-2 border-punk-cyan p-2 grid grid-cols-5 gap-1 shadow-[0_0_30px_rgba(0,255,255,0.5)]"
                  >
                    {emojis.map(emoji => (
                      <button 
                        key={emoji} 
                        onClick={() => {
                          onSendEmoji(player.id, emoji);
                          setShowEmojiPicker(null);
                        }}
                        className="text-xl hover:scale-125 transition-transform p-1"
                      >
                        {emoji}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>

      {/* Center Zone: Table (Yellow Area) & Numbers (Red Area) */}
      <div className="flex flex-col gap-8 items-stretch">
        <div className="flex-1 punk-card border-yellow-500/30 flex flex-col items-center justify-center relative overflow-hidden bg-yellow-500/5 shadow-[inset_0_0_100px_rgba(234,179,8,0.05)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(234,179,8,0.1)_0%,transparent_70%)] pointer-events-none" />
          
          <div className="relative z-10 text-center">
            <p className="text-punk-neon font-black uppercase italic tracking-[0.5em] text-sm mb-8">SIRADAKİ NUMARA</p>
            
            <div className="relative">
              <motion.div 
                key={room.currentNumber}
                initial={{ scale: 0.5, opacity: 0, rotate: -20 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                className="w-64 h-64 rounded-full border-[12px] border-punk-neon flex items-center justify-center bg-black shadow-[0_0_80px_rgba(255,0,255,0.4)] relative group"
              >
                <div className="absolute inset-0 rounded-full border-4 border-white/10 animate-ping opacity-20" />
                <span className="text-9xl font-black italic glitch-text text-white drop-shadow-[0_0_20px_rgba(255,255,255,0.5)]">
                  {room.currentNumber || '--'}
                </span>
              </motion.div>
              
              {timeLeft !== null && (
                <div className="absolute -bottom-16 left-1/2 -translate-x-1/2 w-full">
                  <p className="text-4xl font-black italic text-white/90 tracking-tighter">{timeLeft}s</p>
                  <div className="w-48 h-2 bg-white/10 mx-auto mt-3 rounded-full overflow-hidden border border-white/5">
                    <motion.div 
                      className="h-full bg-punk-cyan shadow-[0_0_15px_#00ffff]"
                      initial={{ width: "100%" }}
                      animate={{ width: "0%" }}
                      transition={{ duration: timeLeft, ease: "linear" }}
                      key={room.currentNumber}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="mt-32 max-w-md mx-auto">
              <p className="text-punk-purple font-black italic uppercase text-lg animate-pulse leading-tight">
                "{room.lastAnnouncement}"
              </p>
            </div>
          </div>

          {/* Infrastructure Badge */}
          <div className="absolute top-6 right-6 flex items-center gap-3 px-4 py-2 bg-black/60 border-2 border-white/10 rounded-none skew-x-[-10deg]">
            <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-ping" />
            <span className="text-[10px] font-black uppercase tracking-widest text-white/80">
              {room.serverType === 'aws' ? 'AWS CLOUD INFRA' : room.serverType === 'clf' ? 'CLOUDFLARE EDGE' : 'LOCAL HOST SERVER'}
            </span>
          </div>
        </div>

        {/* Bottom Zone: Your Card (Orange Area) */}
        <div className="punk-card border-orange-500/30 p-8 bg-orange-500/5 shadow-[inset_0_0_50px_rgba(249,115,22,0.05)]" ref={cardRef}>
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-orange-500 font-black uppercase italic text-lg tracking-widest">SENİN KARTIN</h3>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3 bg-black/60 px-4 py-2 border-2 border-punk-neon/30">
                <span className="text-punk-cyan font-black italic uppercase text-sm tracking-tighter">{me.name}</span>
                <VerificationBadge name={me.name} />
                <span className="text-[10px] opacity-40 font-bold ml-2">ID: {me.userId.substring(0, 8)}</span>
                <span className="text-[10px] text-punk-purple font-black ml-4 tracking-[0.2em]">PUNK SERİ // 2026</span>
              </div>
            </div>
          </div>

          <div className="flex gap-10 items-center">
            <div className="grid grid-rows-3 gap-3 flex-1">
              {me.card.map((row, ri) => (
                <div key={ri} className="grid grid-cols-9 gap-3">
                  {row.map((num, ci) => (
                    <button
                      key={ci}
                      disabled={num === 0 || !room.drawnNumbers.includes(num)}
                      onClick={() => onCheck(num)}
                      className={cn(
                        "h-16 flex items-center justify-center text-3xl font-black transition-all relative overflow-hidden border-2",
                        num === 0 ? "bg-white/5 border-white/5 opacity-10 cursor-default" : 
                        me.checkedNumbers.includes(num) ? "bg-punk-neon text-black border-white shadow-[0_0_20px_rgba(255,0,255,0.6)] scale-95" :
                        room.drawnNumbers.includes(num) ? "bg-punk-purple/40 text-white border-punk-neon animate-pulse shadow-[0_0_15px_rgba(255,0,255,0.3)]" :
                        "bg-black border-white/10 text-white/30 hover:border-punk-neon hover:text-white"
                      )}
                    >
                      {num !== 0 && num}
                      {num !== 0 && me.checkedNumbers.includes(num) && (
                        <div className="absolute inset-0 bg-white/20 animate-ping pointer-events-none" />
                      )}
                    </button>
                  ))}
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-4 w-64">
              <button 
                onClick={onLeave}
                className="punk-button bg-transparent border-white/20 text-white/40 hover:border-red-500 hover:text-red-500 py-4 text-sm tracking-widest"
              >
                AYRIL
              </button>
              <button 
                onClick={onBingo}
                disabled={!hasBingo}
                className={cn(
                  "punk-button py-8 text-3xl shadow-[0_0_50px_rgba(255,0,255,0.2)] transition-all",
                  hasBingo 
                    ? "bg-punk-neon text-black border-white animate-bounce shadow-[0_0_40px_rgba(255,0,255,0.8)]" 
                    : "opacity-10 grayscale cursor-not-allowed border-white/10"
                )}
              >
                TOMBALA!
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Right Zone: History (Blue Area) */}
      <div className="punk-card border-blue-500/30 p-6 flex flex-col gap-6 overflow-hidden bg-blue-500/5 shadow-[inset_0_0_50px_rgba(59,130,246,0.05)]">
        <h3 className="text-blue-500 font-black uppercase italic text-sm border-b-2 border-blue-500/20 pb-2 tracking-widest">GEÇMİŞ</h3>
        <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
          <div className="grid grid-cols-3 gap-3">
            {room.drawnNumbers.slice().reverse().map((num, i) => (
              <motion.div 
                key={`${num}-${i}`}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className={cn(
                  "h-16 flex items-center justify-center text-xl font-black border-l-4 transition-all",
                  i === 0 ? "bg-punk-purple border-punk-neon text-white shadow-[0_0_15px_rgba(255,0,255,0.3)] scale-105 z-10" : "bg-white/5 border-white/10 text-white/30"
                )}
              >
                {num}
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function WinnerView({ room, onNewGame }: { room: Room, onNewGame: () => void }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onNewGame();
    }, 10000); // 10 seconds auto redirect
    return () => clearTimeout(timer);
  }, [onNewGame]);

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.5 }}
      className="punk-card p-12 flex flex-col items-center text-center gap-8 bg-punk-neon/10 border-punk-neon"
    >
      <Trophy className="w-24 h-24 text-punk-neon animate-bounce" />
      <div>
        <h2 className="text-6xl font-black uppercase italic glitch-text mb-2">KAZANAN!</h2>
        <p className="text-2xl font-bold uppercase tracking-widest">{room.winner?.name}</p>
      </div>
      
      <div className="flex items-center gap-4 p-4 bg-black/40 border-2 border-punk-neon skew-x-[-5deg]">
        <img src={room.winner?.photo} alt={room.winner?.name} className="w-20 h-20 object-cover" />
        <div className="text-left">
          <p className="text-xs opacity-50 font-black uppercase">Final Durumu</p>
          <p className="text-3xl font-black italic">15/15 EŞLEŞTİ</p>
        </div>
      </div>

      <button onClick={onNewGame} className="punk-button text-2xl px-12 py-4 mt-4">
        MENÜYE DÖN
      </button>
    </motion.div>
  );
}
