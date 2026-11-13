import { Context } from "hono";
import { handleMailListQuery } from "../common";
import { resolveRawEmailRow } from "../gzip";

export default {
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
