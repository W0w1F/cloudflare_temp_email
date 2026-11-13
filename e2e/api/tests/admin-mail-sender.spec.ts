import { test, expect } from '@playwright/test';
import { WORKER_URL, createTestAddress, seedTestMail, deleteAddress } from '../../fixtures/test-helpers';

test('admin sender filter spans mailboxes, composes with address and paginates', async ({ request }) => {
  const a = await createTestAddress(request, 'sender-a');
  const b = await createTestAddress(request, 'sender-b');
  const sender = `sender-${Date.now()}-${Math.random().toString(36).slice(2)}@example.org`;
  const query = async (params: Record<string, string>) => {
    const res = await request.get(`${WORKER_URL}/admin/mails`, {
      params: { limit: '100', offset: '0', sender, ...params },
    });
    expect(res.status()).toBe(200);
    return res.json();
  };
  try {
    await seedTestMail(request, a.address, { from: sender, text: 'sender filter payload' });
    await seedTestMail(request, b.address, { from: sender });
    await seedTestMail(request, a.address, { from: `other-${sender}` });
    const all = await query({ sender: ` ${sender.toUpperCase()} ` });
    expect(all.count).toBe(2);
    expect(all.results).toHaveLength(2);
    expect(new Set(all.results.map((mail: any) => mail.address))).toEqual(new Set([a.address, b.address]));
    expect(all.results.every((mail: any) => mail.source === sender && typeof mail.raw === 'string')).toBe(true);
    const restricted = await query({ address: a.address });
    expect(restricted.count).toBe(1);
    expect(restricted.results[0].raw).toContain('sender filter payload');
    const first = await query({ limit: '1' });
    const second = await query({ limit: '1', offset: '1' });
    expect(first.results).toHaveLength(1);
    expect(second.results).toHaveLength(1);
    expect(first.results[0].id).not.toBe(second.results[0].id);
    for (const value of ['%', "' OR 1=1 --", `missing-${sender}`]) {
      expect((await query({ sender: value })).results).toEqual([]);
    }
    const empty = await request.get(`${WORKER_URL}/admin/mails`, {
      params: { sender: ' ', limit: '20', offset: '0' },
    });
    expect(empty.status()).toBe(400);
  } finally {
    await deleteAddress(request, a.jwt);
    await deleteAddress(request, b.jwt);
  }
});
