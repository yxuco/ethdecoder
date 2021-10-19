import dbScope from 'nano';

export default function cdb(host, port, dbName, user, password) {
    const url = user ? `http://${user}:${password}@${host}:${port}` : `http://${host}:${port}`;
    const db = dbScope(url).use(dbName);

    async function insert(doc, docType, id, upsert = true) {
        if (id && !doc._rev && upsert) {
            const old = await get(id);
            if (old) {
                // set doc revision for updates
                doc._rev = old._rev;
            }
        }
        if (docType) {
            doc.docType = docType;
        }
        const resp = await db.insert(doc, id);
        if (resp.ok) {
            doc._id = resp.id;
            doc._rev = resp.rev;
        }
        return doc;
    }

    async function get(id) {
        try {
            return await db.get(id);
        } catch (e) {
            return null;
        }
    }

    async function fetch(...keys) {
        const { rows } = await db.fetch({ keys: keys });
        return rows.filter(row => !row.error).map(row => row.doc);
    }

    return { insert, get, fetch };
}