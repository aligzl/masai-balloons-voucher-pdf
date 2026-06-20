import { renderVoucher, type VoucherInput } from './voucher'

export interface Env {
  /** Shared R2 bucket (same one NuxtHub uses) holding the Noto fonts. */
  BLOB: R2Bucket
  /** Shared secret — the main app sends it as `Authorization: Bearer <secret>`. */
  VOUCHER_SECRET: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    // Auth: constant-ish check against the shared secret.
    const auth = request.headers.get('authorization') ?? ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!env.VOUCHER_SECRET || token !== env.VOUCHER_SECRET) {
      return new Response('Unauthorized', { status: 401 })
    }

    let input: VoucherInput
    try {
      input = await request.json()
    } catch {
      return new Response('Invalid JSON body', { status: 400 })
    }
    if (!input?.referenceCode || !input?.locale) {
      return new Response('Missing required fields (referenceCode, locale)', { status: 422 })
    }

    try {
      const pdf = await renderVoucher(input, env.BLOB)
      return new Response(pdf, {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': `inline; filename="voucher-${input.referenceCode}.pdf"`,
          'cache-control': 'no-store'
        }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return new Response(`Voucher generation failed: ${message}`, { status: 500 })
    }
  }
}
