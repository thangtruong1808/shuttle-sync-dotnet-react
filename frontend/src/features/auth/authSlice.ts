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
};

const initialState: AuthState = {
  status: "unknown",
  user: null,
  sessions: [],
};

type AuthSliceState = { auth: AuthState };
type AuthThunk<Result> = ThunkAction<Result, AuthSliceState, unknown, Action>;

const signedIn = createAction<User>("auth/signedIn");
const signedOut = createAction("auth/signedOut");

export const loadCurrentUser = createAsyncThunk("auth/loadCurrentUser", async () => currentUser());

export const fetchSessions = createAsyncThunk("auth/fetchSessions", async () => sessionList());

export function login(email: string, password: string): AuthThunk<Promise<User>> {
  return async (dispatch) => {
    const user = await loginRequest(email, password);
    dispatch(signedIn(user));
    return user;
  };
}

export function register(email: string, password: string): AuthThunk<Promise<void>> {
  return async () => {
    await registerRequest(email, password);
  };
}

export function logout(): AuthThunk<Promise<void>> {
  return async (dispatch) => {
    await apiFetch("/api/auth/logout", { method: "POST" });
    dispatch(signedOut());
  };
}

export function logoutAll(): AuthThunk<Promise<void>> {
  return async (dispatch) => {
    await apiFetch("/api/auth/logout-all", { method: "POST" });
    dispatch(signedOut());
  };
}

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
        }
      })
      .addCase(loadCurrentUser.rejected, (state) => {
        state.user = null;
        state.sessions = [];
        state.status = "anonymous";
      })
      .addCase(signedIn, (state, action) => {
        state.user = action.payload;
        state.status = "authenticated";
      })
      .addCase(signedOut, (state) => {
        state.user = null;
        state.sessions = [];
        state.status = "anonymous";
      })
      .addCase(fetchSessions.fulfilled, (state, action) => {
        state.sessions = action.payload;
      });
  },
});

export default authSlice.reducer;
