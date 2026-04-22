import { createDefine } from "fresh";

// This specifies the type of "ctx.state" which is used to share
// data among middlewares, layouts and routes.
export interface State {
  // BetterAuth types these with slightly different optionality (e.g. `name: string`
  // without null, `image?: string | null | undefined`). We accept the broader
  // shape and let consumers coerce when they need strict nullability.
  user?: {
    id: string;
    name: string | null | undefined;
    email: string;
    emailVerified: boolean;
    image?: string | null | undefined;
    role: string;
    createdAt: Date;
    updatedAt: Date;
  };
  session?: {
    id: string;
    userId: string;
    token: string;
    expiresAt: Date;
    ipAddress?: string | null | undefined;
    userAgent?: string | null | undefined;
    createdAt: Date;
    updatedAt: Date;
  };
}

export const define = createDefine<State>();
