// Lets any page register "what the user is currently looking at" so the
// floating copilot can answer with that context (e.g. a parsed settlement
// statement). Uses a ref so updating context never re-renders consumers.
import { createContext, useContext, useRef, useCallback, useEffect } from 'react'

const AssistantContext = createContext(null)

export function AssistantProvider({ children }) {
  const contextRef = useRef('')

  const setAssistantContext = useCallback((value) => {
    contextRef.current = value || ''
  }, [])

  const getAssistantContext = useCallback(() => contextRef.current, [])

  return (
    <AssistantContext.Provider value={{ setAssistantContext, getAssistantContext }}>
      {children}
    </AssistantContext.Provider>
  )
}

export function useAssistant() {
  const ctx = useContext(AssistantContext)
  if (!ctx) throw new Error('useAssistant must be used within AssistantProvider')
  return ctx
}

/** Convenience hook: register page context for the lifetime of a component. */
export function useAssistantContext(value) {
  const { setAssistantContext } = useAssistant()
  useEffect(() => {
    setAssistantContext(value)
    return () => setAssistantContext('')
  }, [value, setAssistantContext])
}
