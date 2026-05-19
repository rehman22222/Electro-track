import { api } from '@/lib/axios';
import { User } from '@/store/authStore';

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  name: string;
  email: string;
  phoneNumber: string;
  password: string;
}

export interface AuthResponse {
  user: User;
  token: string;
}

export interface VerificationPendingResponse {
  requiresVerification: true;
  email: string;
  message: string;
  devOtpPreview?: string;
}

interface RawArea {
  _id?: string;
  name?: string;
  city?: string;
}

interface RawUser {
  id?: string;
  _id?: string;
  email: string;
  phoneNumber?: string;
  username?: string;
  name?: string;
  role?: User['role'];
  emailVerified?: boolean;
  emailVerifiedAt?: string | null;
  areaId?: string | RawArea | null;
  area?: RawArea | null;
  watchedAreaIds?: Array<string | RawArea>;
  watchedAreas?: RawArea[];
  areaSelectedAt?: string | null;
  lastAreaChangeAt?: string | null;
  alertPreferences?: User['alertPreferences'];
  canManageMultipleAreas?: boolean;
  freeAreaLocked?: boolean;
  location?: User['location'];
}

function normalizeUser(raw?: RawUser | null): User {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Authentication response did not include a valid user object.');
  }

  const watchedAreas =
    raw.watchedAreas ||
    raw.watchedAreaIds?.filter((item): item is RawArea => typeof item === 'object' && item !== null) ||
    [];

  return {
    id: raw.id || raw._id,
    email: raw.email,
    phoneNumber: raw.phoneNumber || '',
    username: raw.username || raw.name,
    role: raw.role || 'free',
    emailVerified: raw.emailVerified ?? false,
    emailVerifiedAt: raw.emailVerifiedAt || null,
    areaId:
      typeof raw.areaId === 'string'
        ? raw.areaId
        : raw.areaId?._id || raw.area?._id || null,
    area:
      raw.area ||
      (raw.areaId && typeof raw.areaId === 'object'
        ? {
            _id: raw.areaId._id,
            name: raw.areaId.name,
            city: raw.areaId.city,
          }
        : null),
    watchedAreaIds: raw.watchedAreaIds?.map((item) => (typeof item === 'string' ? item : item._id)).filter(Boolean) || [],
    watchedAreas: watchedAreas.map((item) => ({
      _id: item._id,
      name: item.name,
      city: item.city,
    })),
    areaSelectedAt: raw.areaSelectedAt || null,
    lastAreaChangeAt: raw.lastAreaChangeAt || null,
    alertPreferences: raw.alertPreferences || {
      enabled: false,
      minutesBefore: 15,
      browserPermission: 'default',
    },
    canManageMultipleAreas: raw.canManageMultipleAreas ?? (raw.role === 'premium' || raw.role === 'admin'),
    freeAreaLocked: raw.freeAreaLocked ?? false,
    location: raw.location,
  };
}

function normalizeAuthResponse(payload: unknown): AuthResponse {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Authentication response was empty or malformed.');
  }

  const data = payload as {
    user?: RawUser;
    token?: string;
    message?: string;
    error?: string;
  };

  if (!data.user) {
    throw new Error(
      data.message ||
      data.error ||
      'Authentication response did not include user details.'
    );
  }

  if (!data.token || typeof data.token !== 'string') {
    throw new Error('Authentication response did not include a valid token.');
  }

  return {
    ...(data as Omit<AuthResponse, 'user'>),
    user: normalizeUser(data.user),
    token: data.token,
  };
}

export const authService = {
  login: async (data: LoginRequest): Promise<AuthResponse> => {
    const response = await api.post('/auth/login', data);
    return normalizeAuthResponse(response.data);
  },

  register: async (data: RegisterRequest): Promise<AuthResponse | VerificationPendingResponse> => {
    const response = await api.post('/auth/register', data);
    if (response.data?.requiresVerification) {
      return response.data;
    }
    return normalizeAuthResponse(response.data);
  },

  verifyEmailOtp: async (data: { email: string; otp: string }): Promise<AuthResponse> => {
    const response = await api.post('/auth/verify-email-otp', data);
    return normalizeAuthResponse(response.data);
  },

  resendEmailOtp: async (email: string): Promise<VerificationPendingResponse> => {
    const response = await api.post('/auth/resend-email-otp', { email });
    return response.data;
  },

  getMe: async (): Promise<User> => {
    const response = await api.get('/auth/profile');
    return normalizeUser(response.data.user);
  },

  updateArea: async (areaId: string): Promise<User> => {
    const response = await api.put('/auth/update-area', { areaId });
    return normalizeUser(response.data.user);
  },

  updatePreferences: async (payload: {
    alertPreferences?: User['alertPreferences'];
    location?: User['location'];
  }): Promise<User> => {
    const response = await api.put('/auth/preferences', payload);
    return normalizeUser(response.data.user);
  },

  addWatchArea: async (areaId: string): Promise<User> => {
    const response = await api.post('/auth/watch-areas', { areaId });
    return normalizeUser(response.data.user);
  },

  removeWatchArea: async (areaId: string): Promise<User> => {
    const response = await api.delete(`/auth/watch-areas/${areaId}`);
    return normalizeUser(response.data.user);
  },
};
