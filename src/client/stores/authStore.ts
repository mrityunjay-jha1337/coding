import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { LoginRequest, SignupRequest } from '@shared/authTypes';
import { authApi } from '../api/auth.api';
import { bindAuthStore } from '../api/client';

interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
  orgId: string;
  orgName: string;
  orgType: 'BPO' | 'TPA' | 'INSURER' | 'BROKER';
  mfaEnabled: boolean;
  specialisation?: string | null;
  status?: string;
  lastLoginAt?: string | null;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  login: (data: LoginRequest) => Promise<{ requiresMfa: boolean }>;
  signup: (data: SignupRequest) => Promise<void>;
  fetchMe: () => Promise<void>;
  refreshSession: () => Promise<void>;
  logout: () => Promise<void>;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      login: async (data) => {
        const result = await authApi.login(data);
        if ('requiresMfa' in result && result.requiresMfa) {
          return { requiresMfa: true };
        }

        set({
          user: {
            id: result.user.id,
            email: result.user.email,
            name: result.user.name,
            role: result.user.role,
            permissions: [],
            orgId: result.user.orgId,
            orgName: '',
            orgType: 'BPO',
            mfaEnabled: false,
          },
          accessToken: result.tokens.accessToken,
          refreshToken: result.tokens.refreshToken,
          isAuthenticated: true,
        });

        await get().fetchMe();
        return { requiresMfa: false };
      },
      signup: async (data) => {
        const result = await authApi.signup(data);
        set({
          user: {
            id: result.user.id,
            email: result.user.email,
            name: result.user.name,
            role: result.user.role,
            permissions: [],
            orgId: result.user.orgId,
            orgName: data.organisationName,
            orgType: data.organisationType,
            mfaEnabled: false,
          },
          accessToken: result.tokens.accessToken,
          refreshToken: result.tokens.refreshToken,
          isAuthenticated: true,
        });
        await get().fetchMe();
      },
      fetchMe: async () => {
        const profile = await authApi.me();
        set({
          user: {
            id: profile.id,
            email: profile.email,
            name: profile.name,
            role: profile.role.name,
            permissions: profile.role.permissions,
            orgId: profile.organisation.id,
            orgName: profile.organisation.name,
            orgType: profile.organisation.type,
            mfaEnabled: profile.mfaEnabled,
            specialisation: profile.specialisation,
            status: profile.status,
            lastLoginAt: profile.lastLoginAt,
          },
          isAuthenticated: true,
        });
      },
      refreshSession: async () => {
        const refreshToken = get().refreshToken;
        if (!refreshToken) {
          get().clearAuth();
          return;
        }
        const tokens = await authApi.refresh(refreshToken);
        set({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        });
      },
      logout: async () => {
        const refreshToken = get().refreshToken;
        try {
          if (refreshToken) {
            await authApi.logout(refreshToken);
          }
        } finally {
          get().clearAuth();
        }
      },
      clearAuth: () =>
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
        }),
    }),
    {
      name: 'claimsintell-auth',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);

bindAuthStore({
  getTokens: () => ({
    accessToken: useAuthStore.getState().accessToken,
    refreshToken: useAuthStore.getState().refreshToken,
  }),
  setTokens: (access, refresh) =>
    useAuthStore.setState({
      accessToken: access,
      refreshToken: refresh,
      isAuthenticated: true,
    }),
  clearAuth: () => useAuthStore.getState().clearAuth(),
});
