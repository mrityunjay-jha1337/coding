export interface SignupRequest {
  organisationName: string;
  organisationType: 'BPO' | 'TPA' | 'INSURER' | 'BROKER';
  fcaNumber?: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
}

export interface LoginRequest {
  email: string;
  password: string;
  mfaCode?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface JwtPayload {
  sub: string;
  orgId: string;
  role: string;
  permissions: string[];
  iat?: number;
  exp?: number;
}

export interface InviteUserRequest {
  email: string;
  name: string;
  roleName: string;
  teamId?: string;
  specialisation?: string;
}

export interface AuthResult {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    orgId: string;
  };
  tokens: TokenPair;
  requiresMfa: boolean;
}
