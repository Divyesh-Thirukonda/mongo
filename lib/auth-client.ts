"use client";

import { createAuthClient } from "better-auth/react";
import { anonymousClient } from "better-auth/client/plugins";

// Relative endpoints keep browser and packaged remote-client cookies on their own origin.
export const authClient = createAuthClient({ plugins: [anonymousClient()] });
export interface IdentityUser { id: string; name: string; email?: string; isAnonymous: boolean }
