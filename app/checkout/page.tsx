'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@supabase/supabase-js'
import { CartLine, getCart } from '@/lib/cart'

type Product = {
  id: string
  name: string | null
  offer_price: number | null
  original_price: number | null
  product_images:
    | { url: string | null; alt: string | null; sort_order: number | null }[]
    | null
}

type QuoteRes = {
  subtotal: number
  quote: { label: string; amount: number }
  total: number
}

type PayResp = { upiLink: string; qrImgUrl: string }

const COD_FEE = 0 // change to 50 if you want COD charge

function inr(n: number | null | undefined) {
  if (typeof n !== 'number') return '₹0'
  return `₹${n.toLocaleString('en-IN')}`
}

function pickImage(p?: Product | null) {
  const arr = p?.product_images ?? []
  const valid = arr
    .filter((x) => typeof x?.url === 'string' && /^https?:\/\//i.test(x.url))
    .sort((a, b) => (a.sort_order ?? 9999) - (b.sort_order ?? 9999))
  return valid[0]?.url ?? null
}

export default function CheckoutPage() {
  const [cart, setCart] = useState<CartLine[]>([])
  const [products, setProducts] = useState<Record<string, Product>>({})
  const [pricing, setPricing] = useState<QuoteRes | null>(null)

  // Address
  const [addr, setAddr] = useState({ country: 'IN', state: '', city: '', pincode: '' })
  const [shipAddr, setShipAddr] = useState({ line1: '', line2: '' })

  // Customer
  const [customer, setCustomer] = useState({ name: '', phone: '', email: '' })

  // Payment
  const [payMethod, setPayMethod] = useState<'UPI' | 'COD'>('UPI')
  const [upi, setUpi] = useState<PayResp | null>(null)
  const [utr, setUtr] = useState('')
  const [vpa, setVpa] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const orderId = useMemo(() => `TS-${Date.now()}`, [])
  const supabase = useMemo(
    () => createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    ),
    []
  )

  // Load cart
  useEffect(() => {
    setCart(getCart())
  }, [])

  // Load products
  useEffect(() => {
    async function load(ids: string[]) {
      if (!ids.length) return
      const { data } = await supabase
        .from('products')
        .select('id,name,original_price,offer_price,product_images(url,alt,sort_order)')
        .in('id', ids)
      const map: Record<string, Product> = {}
      data?.forEach((p: any) => (map[p.id] = p))
      setProducts(map)
    }
    load(cart.map((c) => c.productId))
  }, [cart, supabase])

  const subtotal = useMemo(() => {
    return cart.reduce((sum, l) => {
      const p = products[l.productId]
      const price = p?.offer_price ?? p?.original_price ?? 0
      return sum + price * l.qty
    }, 0)
  }, [cart, products])

  const total = subtotal + (payMethod === 'COD' ? COD_FEE : 0)

  // Create UPI when needed
  useEffect(() => {
    if (payMethod !== 'UPI' || total <= 0) return
    ;(async () => {
      const res = await fetch('/api/pay/upi', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amount: total, orderId }),
      })
      if (res.ok) setUpi(await res.json())
    })()
  }, [payMethod, total, orderId])

  async function placeOrder() {
    try {
      setErr(null)

      if (!customer.name || !customer.phone) {
        return setErr('Please enter name and phone')
      }

      if (payMethod === 'UPI' && !utr.trim()) {
        return setErr('Please enter UPI Reference (UTR)')
      }

      const items = cart.map((l) => {
        const p = products[l.productId]
        const price = p?.offer_price ?? p?.original_price ?? 0
        return { productId: l.productId, name: p?.name, price, qty: l.qty }
      })

      const res = await fetch('/api/orders/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items,
          amount: total,
          payment_method: payMethod,
          payment_status: payMethod === 'COD' ? 'cod_pending' : 'paid',
          customer,
          address: { ...shipAddr, ...addr },
          upi:
            payMethod === 'UPI'
              ? { utr: utr.trim(), vpa: vpa || null, note: note || null }
              : null,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Order failed')

      localStorage.setItem('cart', '[]')
      window.location.href = `/thank-you?order=${encodeURIComponent(data.orderNo)}`
    } catch (e: any) {
      setErr(e.message)
    }
  }

  return (
    <main style={{ maxWidth: 980, margin: '0 auto', padding: '40px 24px' }}>
      <h1>Checkout</h1>

      {/* PAYMENT METHOD */}
      <h3>Payment Method</h3>
      <label>
        <input
          type="radio"
          checked={payMethod === 'UPI'}
          onChange={() => setPayMethod('UPI')}
        />{' '}
        Pay by UPI
      </label>
      <br />
      <label>
        <input
          type="radio"
          checked={payMethod === 'COD'}
          onChange={() => setPayMethod('COD')}
        />{' '}
        Cash on Delivery {COD_FEE > 0 ? `(₹${COD_FEE})` : ''}
      </label>

      {/* UPI SECTION */}
      {payMethod === 'UPI' && upi && (
        <>
          <h3 style={{ marginTop: 20 }}>Pay ₹{inr(total)}</h3>
          <img src={upi.qrImgUrl} width={220} alt="UPI QR" />
          <a href={upi.upiLink} target="_blank">Open UPI App</a>
          <input placeholder="UTR" value={utr} onChange={(e) => setUtr(e.target.value)} />
        </>
      )}

      {/* COD INFO */}
      {payMethod === 'COD' && (
        <p style={{ marginTop: 12, color: '#065f46' }}>
          You will pay ₹{inr(total)} in cash at the time of delivery.
        </p>
      )}

      {err && <p style={{ color: 'crimson' }}>{err}</p>}

      <button
        onClick={placeOrder}
        style={{
          marginTop: 20,
          background: '#f59e0b',
          padding: '12px 16px',
          border: 'none',
          borderRadius: 8,
          fontWeight: 700,
        }}
      >
        Place Order
      </button>
    </main>
  )
}
