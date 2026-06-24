import { atom } from "jotai";

import { getTicketMetadata, type TicketMetadata } from "@/lib/api.ts";

export interface TicketMetadataState {
  data: TicketMetadata | null;
  isLoading: boolean;
  errorMessage: string;
  promise: Promise<TicketMetadata> | null;
}

const initialTicketMetadataState: TicketMetadataState = {
  data: null,
  isLoading: false,
  errorMessage: "",
  promise: null,
};

export const ticketMetadataStateAtom = atom<TicketMetadataState>(initialTicketMetadataState);

export const ticketMetadataAtom = atom((get) => get(ticketMetadataStateAtom).data);

export const ensureTicketMetadataAtom = atom(null, async (get, set): Promise<TicketMetadata> => {
  const state = get(ticketMetadataStateAtom);
  if (state.data) return state.data;
  if (state.promise) return state.promise;

  const promise = getTicketMetadata();
  set(ticketMetadataStateAtom, {
    ...state,
    isLoading: true,
    errorMessage: "",
    promise,
  });

  try {
    const data = await promise;
    set(ticketMetadataStateAtom, {
      data,
      isLoading: false,
      errorMessage: "",
      promise: null,
    });
    return data;
  } catch (error) {
    const message = error instanceof Error ? error.message : "加载字段字典失败";
    set(ticketMetadataStateAtom, {
      data: null,
      isLoading: false,
      errorMessage: message,
      promise: null,
    });
    throw error;
  }
});
