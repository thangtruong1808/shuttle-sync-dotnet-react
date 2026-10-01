import { createAction, createAsyncThunk, type Action, type ThunkAction } from "@reduxjs/toolkit";
import { createSlice } from "@reduxjs/toolkit";
import {
  currentUser,
  loginRequest,
  registerRequest,
  sessionList,
  apiFetch,
  type SessionSummary,
  type User,
} from "./authApi";

export type AuthState = {
  status: "unknown" | "authenticated" | "anonymous";
  user: User | null;
  sessions: SessionSummary[];
  sessionsStatus: "idle" | "loading" | "ready";
};

const initialState: AuthState = {
  status: "unknown",
  user: null,
  sessions: [],
  sessionsStatus: "idle",
};

/**
 * The type of the auth slice state.
 * @returns The type of the auth slice state.
 */

type AuthSliceState = { auth: AuthState };
type AuthThunk<Result> = ThunkAction<Result, AuthSliceState, unknown, Action>;

/**
 * The action to sign in a user.
 * @param user The user to sign in.
 * @returns The action to sign in a user.
 */

const signedIn = createAction<User>("auth/signedIn");

/**
 * The action to sign out a user.
 * @returns The action to sign out a user.
 */
const signedOut = createAction("auth/signedOut");

/**
 * The action to load the current user.
 * @returns The action to load the current user.
 */
export const loadCurrentUser = createAsyncThunk("auth/loadCurrentUser", async () => currentUser());

/**
 * The action to fetch the sessions.
 * @returns The action to fetch the sessions.
 */
export const fetchSessions = createAsyncThunk("auth/fetchSessions", async () => sessionList());

/**
 * The function to login a user.
 * @param email The email to login with.
 * @param password The password to login with.
 * @returns The function to login a user.
 */
export function login(email: string, password: string): AuthThunk<Promise<User>> {
  return async (dispatch) => {
    const user = await loginRequest(email, password);
    dispatch(signedIn(user));
    return user;
  };
}

/**
 * The function to register a user.
 * @param email The email to register with.
 * @param password The password to register with.
 * @returns The function to register a user.
 */
export function register(email: string, password: string): AuthThunk<Promise<void>> {
  return async () => {
    await registerRequest(email, password);
  };
}

/**
 * The function to logout a user.
 * @returns The function to logout a user.
 */
export function logout(): AuthThunk<Promise<void>> {
  return async (dispatch) => {
    await apiFetch("/api/auth/logout", { method: "POST" });
    dispatch(signedOut());
  };
}

/**
 * The function to logout all users.
 * @returns The function to logout all users.
 */
export function logoutAll(): AuthThunk<Promise<void>> {
  return async (dispatch) => {
    await apiFetch("/api/auth/logout-all", { method: "POST" });
    dispatch(signedOut());
  };
}

/**
 * The function to revoke a session.
 * @param id The id of the session to revoke.
 * @returns The function to revoke a session.
 */
export function revokeSession(id: string): AuthThunk<Promise<void>> {
  return async (dispatch, getState) => {
    const response = await apiFetch(`/api/auth/sessions/${id}`, { method: "DELETE" });
    if (response.status === 401) {
      dispatch(signedOut());
      return;
    }

    const current = getState().auth.sessions.find((session) => session.id === id);
    if (current?.isCurrent) {
      dispatch(signedOut());
      return;
    }

    await dispatch(fetchSessions());
  };
}

/**
 * Create the auth slice.
 * @returns The auth slice.
 */

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(loadCurrentUser.fulfilled, (state, action) => {
        state.user = action.payload;
        state.status = action.payload ? "authenticated" : "anonymous";
        if (!action.payload) {
          state.sessions = [];
          state.sessionsStatus = "idle";
        }
      })
      .addCase(loadCurrentUser.rejected, (state) => {
        state.user = null;
        state.sessions = [];
        state.sessionsStatus = "idle";
        state.status = "anonymous";
      })
      .addCase(signedIn, (state, action) => {
        state.user = action.payload;
        state.status = "authenticated";
      })
      .addCase(signedOut, (state) => {
        state.user = null;
        state.sessions = [];
        state.sessionsStatus = "idle";
        state.status = "anonymous";
      })
      .addCase(fetchSessions.pending, (state) => {
        state.sessionsStatus = "loading";
      })
      .addCase(fetchSessions.fulfilled, (state, action) => {
        state.sessions = action.payload;
        state.sessionsStatus = "ready";
      })
      .addCase(fetchSessions.rejected, (state) => {
        state.sessionsStatus = "ready";
      });
  },
});

export default authSlice.reducer;
