const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });

export async function handleRelayJobState(ctx, request) {
  const path = new URL(request.url).pathname;
  if (path === '/goals/nonce' && request.method === 'POST') {
    const nonce = crypto.randomUUID();
    await ctx.storage.put('goal_nonce', { nonce, expiresAt: Date.now() + 5 * 60_000 });
    return json({ nonce });
  }
  if (path === '/goals/access' && request.method === 'POST') {
    const { nonce, action, goal } = await request.json();
    try {
      const result = await ctx.storage.transaction(async (txn) => {
        const savedNonce = await txn.get('goal_nonce');
        if (!savedNonce || savedNonce.nonce !== nonce || savedNonce.expiresAt < Date.now()) return null;
        await txn.delete('goal_nonce');
        const goals = (await txn.get('goals')) || {};
        if (action === 'save') goals[goal.asset] = goal;
        else if (action === 'delete') delete goals[goal.asset];
        await txn.put('goals', goals);
        return { authorized: true, goal: action === 'read' ? goals[goal.asset] || null : action === 'delete' ? null : goals[goal.asset] };
      });
      if (!result?.authorized) return json({ error: 'Goal authorization expired or was already used.' }, 409);
      return json({ goal: result.goal });
    } catch { return json({ error: 'Goal storage is temporarily unavailable.' }, 503); }
  }
  if (request.method === 'PUT') {
    const job = await request.json();
    await ctx.storage.put('job', job);
    if (['submitted', 'pending'].includes(job.status)) await ctx.storage.setAlarm(Date.now() + 5000);
    return json({ ok: true });
  }
  if (request.method === 'POST') {
    const { paymentHash, finalized } = await request.json();
    try {
      const result = await ctx.storage.transaction(async (txn) => {
        const job = await txn.get('job');
        if (!job) return { claimed: false, status: 'unknown' };
        if (!finalized && job.status === 'awaiting_nim') {
          const updated = { ...job, status: 'nim_pending', nimTxHash: paymentHash };
          await txn.put('job', updated);
          return { claimed: true, status: updated.status };
        }
        if (!finalized && job.status === 'nim_pending' && job.nimTxHash?.toLowerCase() === paymentHash.toLowerCase()) return { claimed: true, status: job.status };
        if (finalized && ['awaiting_nim', 'nim_pending'].includes(job.status) && (job.status === 'awaiting_nim' || job.nimTxHash?.toLowerCase() === paymentHash.toLowerCase())) {
          const updated = { ...job, status: 'relaying', nimTxHash: paymentHash };
          await txn.put('job', updated);
          return { claimed: true, status: updated.status };
        }
        return { claimed: false, status: job.status };
      });
      return json(result, result.status === 'unknown' ? 404 : 200);
    } catch { return json({ error: 'Relay job storage is temporarily unavailable.' }, 503); }
  }
  if (request.method === 'GET') return json(await ctx.storage.get('job') || { status: 'unknown' });
  return json({ error: 'Method not allowed' }, 405);
}

export async function handlePaymentClaim(ctx, request) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const { hash, quoteId } = await request.json();
  if (!/^(?:0x)?[0-9a-f]{64}$/i.test(String(hash || '')) || !/^[0-9a-f-]{36}$/i.test(String(quoteId || ''))) {
    return json({ error: 'Invalid payment claim.' }, 400);
  }
  const key = `nim:${hash.replace(/^0x/i, '').toLowerCase()}`;
  const claimed = await ctx.storage.transaction(async (txn) => {
    const existing = await txn.get(key);
    if (existing) return existing === quoteId;
    await txn.put(key, quoteId);
    return true;
  });
  return json({ claimed });
}
