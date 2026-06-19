// Lets any page register "what the user is currently looking at" so the
// floating copilot can answer with that context (e.g. a parsed settlement
// statement). Uses a ref so updating context never re-renders consumers.
import { createContext, useContext, useRef, useCallback, useEffect } from 'react'

const AssistantContext = createContext(null)

export function AssistantProvider({ children }) {
  const contextRef = useRef('')
  const openerRef  = useRef(null)   // the widget registers its "open with prompt" fn here

  const setAssistantContext = useCallback((value) => {
    contextRef.current = value || ''
  }, [])

  const getAssistantContext = useCallback(() => contextRef.current, [])

  // The floating widget calls this once to expose how it should be opened.
  const registerOpener = useCallback((fn) => { openerRef.current = fn }, [])

  // Any component can pop the copilot open, optionally seeding the input.
  const askAssistant = useCallback((prompt = '') => { openerRef.current?.(prompt) }, [])

  return (
    <AssistantContext.Provider value={{ setAssistantContext, getAssistantContext, registerOpener, askAssistant }}>
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
