import { Context } from "hono";
import { handleMailListQuery } from "../common";
import { resolveRawEmailList, resolveRawEmailRow } from "../gzip";

export default {
    getMailCheckpoint: async (c: Context<HonoCustomType>) => {
        const cursor = Number(await c.env.DB.prepare(
            "SELECT COALESCE(MAX(id), 0) AS cursor FROM raw_mails"
        ).first("cursor"));
        // Checkpoints must be fresh even when clients or proxies cache GET responses.
        c.header("Cache-Control", "no-store");
        return c.json({ cursor });
    },
    syncMails: async (c: Context<HonoCustomType>) => {
        const { sender, address, cursor = "0", until_id, limit = "100" } = c.req.query();
        if (!sender?.trim()) return c.text("sender is required", 400);
        if (address !== undefined && !address.trim()) {
            return c.text("address must not be empty", 400);
        }
        const validId = (value: string) => /^\d+$/.test(value)
            && Number.isSafeInteger(Number(value));
        if (!validId(cursor) || !validId(limit) || Number(limit) < 1 || Number(limit) > 100
            || (until_id !== undefined && (!validId(until_id) || Number(until_id) < Number(cursor)))) {
            return c.text("Invalid cursor, until_id or limit", 400);
        }
        const afterId = Number(cursor);
        // Preserve the checkpoint even when the highest retained mail was deleted.
        // This protocol requires generated IDs never to be reused across sync calls.
        const upperId = until_id !== undefined ? Number(until_id) : Math.max(afterId,
            Number(await c.env.DB.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM raw_mails").first("id")));
        const params: (string | number)[] = [sender.trim(), afterId, upperId];
        const recipientFilter = address !== undefined ? " AND address = ?" : "";
        if (address !== undefined) params.push(address.trim());
        const pageSize = Number(limit);
        const { results } = await c.env.DB.prepare(
            `SELECT * FROM raw_mails WHERE source = ? COLLATE NOCASE AND id > ? AND id <= ?`
            + recipientFilter + " ORDER BY id ASC LIMIT ?"
        ).bind(...params, pageSize + 1).all<{ id: number }>();
        const hasMore = results.length > pageSize;
        const page = results.slice(0, pageSize);
        return c.json({
            results: await resolveRawEmailList(page),
            next_cursor: hasMore ? page[page.length - 1].id : upperId,
            until_id: upperId,
            has_more: hasMore,
        });
    },
    getMails: async (c: Context<HonoCustomType>) => {
        const { address, sender, limit, offset } = c.req.query();
        // An explicitly empty sender must not accidentally expose an unfiltered list.
        if (sender !== undefined && !sender.trim()) {
            return c.text("sender must not be empty", 400);
        }
        const senderQuery = sender !== undefined ? `source = ? COLLATE NOCASE` : "";
        const senderParams = sender !== undefined ? [sender.trim()] : [];
        const addressQuery = address ? `address = ?` : "";
        const addressParams = address ? [address] : [];
        const filterQuerys = [addressQuery, senderQuery].filter((item) => item).join(" and ");
        const finalQuery = filterQuerys.length > 0 ? `where ${filterQuerys}` : "";
        const filterParams = [...addressParams, ...senderParams]
        return await handleMailListQuery(c,
            `SELECT * FROM raw_mails ${finalQuery}`,
            `SELECT count(*) as count FROM raw_mails ${finalQuery}`,
            filterParams, limit, offset
        );
    },
    getUnknowMails: async (c: Context<HonoCustomType>) => {
        const { limit, offset } = c.req.query();
        return await handleMailListQuery(c,
            `SELECT * FROM raw_mails where address NOT IN (select name from address) `,
            `SELECT count(*) as count FROM raw_mails`
            + ` where address NOT IN (select name from address) `,
            [], limit, offset
        );
    },
    getMail: async (c: Context<HonoCustomType>) => {
        const { id } = c.req.param();
        const result = await c.env.DB.prepare(
            `SELECT * FROM raw_mails WHERE id = ?`
        ).bind(id).first();
        if (!result) return c.json(null);
        return c.json(await resolveRawEmailRow(result));
    },
    deleteMail: async (c: Context<HonoCustomType>) => {
        const { id } = c.req.param();
        const { success } = await c.env.DB.prepare(
            `DELETE FROM raw_mails WHERE id = ? `
        ).bind(id).run();
        return c.json({
            success: success
        })
    }
}
