import { useMemo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { EditorView } from '@codemirror/view'

type Props = {
  value: string
  onChange: (value: string) => void
}

const RawEditor = ({ value, onChange }: Props): React.JSX.Element => {
  const extensions = useMemo(
    () => [
      markdown(),
      EditorView.lineWrapping,
      EditorView.theme({
        '&': {
          fontSize: '14px',
          height: '100%'
        },
        '.cm-scroller': {
          fontFamily:
            'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
          padding: '40px 48px'
        },
        '.cm-content': {
          caretColor: 'var(--foreground)'
        },
        '&.cm-focused': {
          outline: 'none'
        }
      })
    ],
    []
  )

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false
      }}
      className="h-full"
      height="100%"
    />
  )
}

export default RawEditor
