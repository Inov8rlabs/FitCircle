import { create } from 'zustand';

interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
  timestamp: string;
  read: boolean;
  action?: {
    label: string;
    href: string;
  };
}

interface UIState {
  // Navigation
  isSidebarOpen: boolean;
  isBottomNavVisible: boolean;
  activeTab: string;

  // Modals
  modals: {
    isCheckInOpen: boolean;
    isChallengeCreateOpen: boolean;
    isTeamCreateOpen: boolean;
    isProfileEditOpen: boolean;
    isPhotoViewerOpen: boolean;
    isShareOpen: boolean;
  };

  // Notifications
  notifications: Notification[];
  unreadCount: number;

  // Loading states
  isGlobalLoading: boolean;
  loadingMessage: string | null;

  // Theme
  theme: 'light' | 'dark' | 'system';

  // Mobile specific
  isPullToRefresh: boolean;
  swipeDirection: 'left' | 'right' | null;
  bottomSheetHeight: number;

  // Actions
  toggleSidebar: () => void;
  setBottomNavVisible: (visible: boolean) => void;
  setActiveTab: (tab: string) => void;

  openModal: (modal: keyof UIState['modals']) => void;
  closeModal: (modal: keyof UIState['modals']) => void;
  closeAllModals: () => void;

  addNotification: (notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) => void;
  markNotificationAsRead: (id: string) => void;
  markAllNotificationsAsRead: () => void;
  removeNotification: (id: string) => void;
  clearNotifications: () => void;

  setGlobalLoading: (loading: boolean, message?: string) => void;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;

  setPullToRefresh: (refreshing: boolean) => void;
  setSwipeDirection: (direction: 'left' | 'right' | null) => void;
  setBottomSheetHeight: (height: number) => void;

  // Toast notifications
  showToast: (message: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  // Initial states
  isSidebarOpen: false,
  isBottomNavVisible: true,
  activeTab: 'home',

  modals: {
    isCheckInOpen: false,
    isChallengeCreateOpen: false,
    isTeamCreateOpen: false,
    isProfileEditOpen: false,
    isPhotoViewerOpen: false,
    isShareOpen: false,
  },

  notifications: [],
  unreadCount: 0,

  isGlobalLoading: false,
  loadingMessage: null,

  theme: 'system',

  isPullToRefresh: false,
  swipeDirection: null,
  bottomSheetHeight: 0,

  // Actions
  toggleSidebar: () => set(state => ({ isSidebarOpen: !state.isSidebarOpen })),

  setBottomNavVisible: (visible: boolean) => set({ isBottomNavVisible: visible }),

  setActiveTab: (tab: string) => set({ activeTab: tab }),

  openModal: (modal: keyof UIState['modals']) => {
    set(state => ({
      modals: {
        ...state.modals,
        [modal]: true,
      },
    }));
  },

  closeModal: (modal: keyof UIState['modals']) => {
    set(state => ({
      modals: {
        ...state.modals,
        [modal]: false,
      },
    }));
  },

  closeAllModals: () => {
    set(state => ({
      modals: Object.keys(state.modals).reduce((acc, key) => {
        acc[key as keyof UIState['modals']] = false;
        return acc;
      }, {} as UIState['modals']),
    }));
  },

  addNotification: (notification) => {
    const newNotification: Notification = {
      ...notification,
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      read: false,
    };

    set(state => ({
      notifications: [newNotification, ...state.notifications],
      unreadCount: state.unreadCount + 1,
    }));

    // Auto-remove after 10 seconds for non-error notifications
    if (notification.type !== 'error') {
      setTimeout(() => {
        get().removeNotification(newNotification.id);
      }, 10000);
    }
  },

  markNotificationAsRead: (id: string) => {
    set(state => ({
      notifications: state.notifications.map(n =>
        n.id === id ? { ...n, read: true } : n
      ),
      unreadCount: Math.max(0, state.unreadCount - 1),
    }));
  },

  markAllNotificationsAsRead: () => {
    set(state => ({
      notifications: state.notifications.map(n => ({ ...n, read: true })),
      unreadCount: 0,
    }));
  },

  removeNotification: (id: string) => {
    set(state => {
      const notification = state.notifications.find(n => n.id === id);
      const wasUnread = notification && !notification.read;

      return {
        notifications: state.notifications.filter(n => n.id !== id),
        unreadCount: wasUnread ? Math.max(0, state.unreadCount - 1) : state.unreadCount,
      };
    });
  },

  clearNotifications: () => {
    set({
      notifications: [],
      unreadCount: 0,
    });
  },

  setGlobalLoading: (loading: boolean, message?: string) => {
    set({
      isGlobalLoading: loading,
      loadingMessage: message || null,
    });
  },

  setTheme: (theme: 'light' | 'dark' | 'system') => {
    set({ theme });

    // Apply theme to document
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      root.classList.remove('light', 'dark');

      if (theme === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        root.classList.add(prefersDark ? 'dark' : 'light');
      } else {
        root.classList.add(theme);
      }
    }
  },

  setPullToRefresh: (refreshing: boolean) => {
    set({ isPullToRefresh: refreshing });
  },

  setSwipeDirection: (direction: 'left' | 'right' | null) => {
    set({ swipeDirection: direction });
  },

  setBottomSheetHeight: (height: number) => {
    set({ bottomSheetHeight: height });
  },

  showToast: (message: string, type = 'info') => {
    get().addNotification({
      title: type.charAt(0).toUpperCase() + type.slice(1),
      message,
      type,
    });
  },
}));