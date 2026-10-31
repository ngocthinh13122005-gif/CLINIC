import { configureStore, createSlice } from '@reduxjs/toolkit';

const uiSlice = createSlice({
  name: 'ui',
  initialState: { realtimeMode: 'rest', apiOnline: true },
  reducers: {
    setRealtimeMode: (state, action) => { state.realtimeMode = action.payload; },
    setApiOnline: (state, action) => { state.apiOnline = Boolean(action.payload); },
  },
});

export const { setRealtimeMode, setApiOnline } = uiSlice.actions;
export const store = configureStore({ reducer: { ui: uiSlice.reducer } });
