// Edge Function: team-admin
// Gestione team lato server (solo admin). Crea collaboratori (= login) in sicurezza.
// Il service_role NON tocca mai il browser: vive solo qui.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const srk = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(url, srk, { auth: { persistSession: false } })

    // 1) verifica che il chiamante sia admin
    const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '')
    const { data: { user }, error: uErr } = await admin.auth.getUser(jwt)
    if (uErr || !user) return json(401, { error: 'Non autenticato' })
    const { data: prof } = await admin.from('profiles').select('role').eq('id', user.id).single()
    if (!prof || prof.role !== 'admin') return json(403, { error: 'Solo gli admin possono gestire il team' })

    const body = await req.json().catch(() => ({}))
    const action = body.action

    // 2) crea collaboratore (= account login + profilo)
    if (action === 'create') {
      const email = String(body.email || '').trim().toLowerCase()
      const name = String(body.name || '').trim()
      if (!email || !name) return json(400, { error: 'Nome ed email sono obbligatori' })
      const { data: nu, error: cErr } = await admin.auth.admin.createUser({
        email,
        password: String(body.password || 'CollabStore123!'),
        email_confirm: true,
        user_metadata: { display_name: name },
      })
      if (cErr || !nu?.user) return json(400, { error: cErr?.message || 'Creazione fallita (email già usata?)' })
      const { error: pErr } = await admin.from('profiles').upsert({
        id: nu.user.id, display_name: name, role: 'collaborator',
        sales_role: body.sales_role || null, active: true, trackable: true,
      })
      if (pErr) return json(400, { error: pErr.message })
      return json(200, { ok: true, id: nu.user.id, email })
    }

    // 3) attiva / disattiva (soft)
    if (action === 'set_active') {
      const id = String(body.id || '')
      if (!id) return json(400, { error: 'id mancante' })
      const { error } = await admin.from('profiles').update({ active: !!body.active }).eq('id', id)
      if (error) return json(400, { error: error.message })
      return json(200, { ok: true })
    }

    // 4) ELIMINA DAVVERO (auth user → cascade su profili/entries). Niente admin.
    if (action === 'delete') {
      const id = String(body.id || '')
      if (!id) return json(400, { error: 'id mancante' })
      const { data: tgt } = await admin.from('profiles').select('role').eq('id', id).single()
      if (tgt?.role === 'admin') return json(403, { error: 'Non si può eliminare un admin' })
      const { error } = await admin.auth.admin.deleteUser(id)
      if (error) return json(400, { error: error.message })
      return json(200, { ok: true })
    }

    // 5) purge: elimina davvero tutti i disattivati (non admin)
    if (action === 'purge_inactive') {
      const { data: inact } = await admin.from('profiles').select('id,role').eq('active', false)
      let removed = 0
      for (const p of (inact || [])) {
        if (p.role === 'admin') continue
        const { error } = await admin.auth.admin.deleteUser(p.id)
        if (!error) removed++
      }
      return json(200, { ok: true, removed })
    }

    return json(400, { error: 'Azione sconosciuta' })
  } catch (e) {
    return json(500, { error: String(e) })
  }
})
