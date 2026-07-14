// Settlement tab — shows how the acquisition was recorded (the reconstructed
// settlement statement + cash-to-close balance check) and lets you re-open it
// for editing (e.g. fix the earnest money) so it stays balanced.
import { useState, useEffect, useMemo } from 'react'
import { FileText, Pencil, Loader2, Upload } from 'lucide-react'
import Button from '../ui/Button'
import { getSettlementRecord } from '../../api/client'
import SettlementUpload, { ReconstructedStatement, deriveFields } from './SettlementUpload'

export default function SettlementTab({ propertyId, property, onChanged }) {
  const [record, setRecord]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)   // false | 'new' | 'edit'

  const load = () => getSettlementRecord(propertyId)
    .then(r => setRecord(r?.record || null))
    .catch(() => setRecord(null))
    .finally(() => setLoading(false))
  useEffect(() => { load() }, [propertyId]) // eslint-disable-line react-hooks/exhaustive-deps

  const derived = useMemo(
    () => (record?.fields ? deriveFields(record.fields, record.lineItems || []) : null),
    [record],
  )

  if (loading) return <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /></div>

  return (
    <div className="max-w-3xl mx-auto px-6 py-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-1.5"><FileText className="w-4 h-4" /> Settlement Statement</h2>
          <p className="text-xs text-slate-400">How the acquisition was recorded. Edit to fix a line and keep it balanced.</p>
        </div>
        {record && (
          <Button variant="secondary" onClick={() => setEditing('edit')}>
            <Pencil className="w-4 h-4" /> Edit
          </Button>
        )}
      </div>

      {!record ? (
        <div className="flex flex-col items-center justify-center py-14 text-slate-400 gap-3">
          <p className="text-sm font-medium">No settlement statement recorded yet</p>
          <p className="text-xs">Upload the closing statement to record the acquisition.</p>
          <Button onClick={() => setEditing('new')}><Upload className="w-4 h-4" /> Upload settlement statement</Button>
        </div>
      ) : (
        <ReconstructedStatement lineItems={record.lineItems || []} fields={derived} />
      )}

      {editing && (
        <SettlementUpload
          propertyId={propertyId}
          property={property}
          initialData={editing === 'edit' ? record : undefined}
          onSaved={() => { onChanged?.(); load() }}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  )
}
