import Modal from './Modal'
import Button from './Button'

export default function ConfirmDialog({ isOpen, onClose, onConfirm, title = 'Are you sure?', message, confirmLabel = 'Delete', danger = true }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <div className="px-6 py-5">
        <p className="text-sm text-slate-600">{message}</p>
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={() => { onConfirm(); onClose() }}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
