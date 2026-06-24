import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

type SocraticContextValue = {
  topicId: string | null;
  setTopicId: (id: string | null) => void;
  fabVisible: boolean;
  setFabVisible: (v: boolean) => void;
};

const SocraticContext = createContext<SocraticContextValue>({
  topicId: null,
  setTopicId: () => {},
  fabVisible: true,
  setFabVisible: () => {},
});

export function SocraticProvider({ children }: { children: React.ReactNode }) {
  const [topicId, setTopicIdState] = useState<string | null>(null);
  const [fabVisible, setFabVisible] = useState(true);

  const setTopicId = useCallback((id: string | null) => {
    setTopicIdState(id);
  }, []);

  return (
    <SocraticContext.Provider value={{ topicId, setTopicId, fabVisible, setFabVisible }}>
      {children}
    </SocraticContext.Provider>
  );
}

export function useSocratic() {
  return useContext(SocraticContext);
}
