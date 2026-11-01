import { useEffect } from 'react'
import type { UseFormRegister, UseFormSetValue } from 'react-hook-form'
import { useLc, useLcs } from '../../api/lc'
import { ds } from '../../ds'
import type { BillFormValues } from '../../lib/billSchema'

/**
 * F3 import mode (backlog P16.2-FE, F3 "Receive goods" from M4): the LC and lot this bill receives, the LC's currency and
 * the rate. Unit costs are entered in that currency; the bill's taka figures come from POST /purchase-bills/calculate.
 * A blank rate lets the server take the LC's payment rate, else its planning rate (06 §12.5).
 */
export function ImportFields({ values, register, setValue, errors }: {
  values: BillFormValues; register: UseFormRegister<BillFormValues>; setValue: UseFormSetValue<BillFormValues>; errors: Record<string, { message?: string } | undefined>
}) {
  const { Card, Field, Select, Input } = ds()
  const partyId = values.party?.id ?? 0
  const lcs = useLcs({ party_id: partyId || undefined, per_page: 100 }, partyId > 0)
  const lcId = Number(values.letter_of_credit_id) || 0
  const lc = useLc(lcId)
  // The LC fixes the bill's currency.
  useEffect(() => {
    if (lc.data && values.currency_code !== lc.data.currency_code) setValue('currency_code', lc.data.currency_code, { shouldDirty: true })
  }, [lc.data]) // eslint-disable-line react-hooks/exhaustive-deps
  const usable = (lcs.data?.data ?? []).filter((l) => !['draft', 'awaiting_bank', 'cancelled', 'closed'].includes(l.status) || l.id === lcId)
  const lots = lc.data?.shipments ?? []
  return (
    <div data-testid="bill-import"><Card title="Import" subtitle="Goods received against a letter of credit, in its currency">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        <Field label="Letter of credit" htmlFor="f-lc" error={errors.letter_of_credit_id?.message}>
          <Select id="f-lc" value={values.letter_of_credit_id ?? ''} onChange={(e) => { setValue('letter_of_credit_id', e.target.value, { shouldDirty: true }); setValue('lc_shipment_id', '', { shouldDirty: true }) }} invalid={!!errors.letter_of_credit_id}
            options={[{ value: '', label: partyId ? 'No LC' : 'Choose the supplier first' }, ...usable.map((l) => ({ value: String(l.id), label: `${l.lc_number} · ${l.currency_code} ${l.outstanding_foreign} open` }))]} />
        </Field>
        {lcId > 0 && (
          <Field label="Shipment lot" htmlFor="f-lot" error={errors.lc_shipment_id?.message}>
            <Select id="f-lot" value={values.lc_shipment_id ?? ''} onChange={(e) => setValue('lc_shipment_id', e.target.value, { shouldDirty: true })} options={[{ value: '', label: 'Not tied to a lot' }, ...lots.map((s) => ({ value: String(s.id), label: `Lot ${s.lot_no}${s.bl_number ? ` · ${s.bl_number}` : ''}` }))]} />
          </Field>
        )}
        <Field label="Currency" htmlFor="f-currency" error={errors.currency_code?.message} hint={lcId ? "The LC's currency" : undefined}>
          <Select id="f-currency" value={values.currency_code || 'BDT'} onChange={(e) => setValue('currency_code', e.target.value, { shouldDirty: true })} disabled={lcId > 0} options={['BDT', 'USD', 'EUR', 'CNY', 'GBP', 'JPY', 'INR']} />
        </Field>
        {values.currency_code && values.currency_code !== 'BDT' && (
          <Field label={`Rate (৳ per ${values.currency_code})`} htmlFor="f-rate" error={errors.exchange_rate?.message}
            hint={lcId ? `Blank: the LC's payment rate, else its planning rate${lc.data ? ` (${lc.data.planning_rate})` : ''}` : 'Required for a foreign-currency bill'}>
            <Input id="f-rate" inputMode="decimal" align="right" mono {...register('exchange_rate')} invalid={!!errors.exchange_rate} />
          </Field>
        )}
      </div>
    </Card></div>
  )
}
