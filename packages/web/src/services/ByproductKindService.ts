// ByproductKindService — the by-products a mill handles (Stock > Catalog).
import api from "./api";

/** Ipa, darak and binlid come with every mill (`built_in`, no id); the rest
 *  the Boss adds. Records keep the code; the name is what the pages show. */
export type ByproductKind = {
  id: string | null;
  code: string;
  name: string;
  built_in: boolean;
  is_active: boolean;
};

export class ByproductKindService {
  constructor(private http = api) {}

  /** Hidden ones too: their names still show on the records that have them. */
  list(): Promise<ByproductKind[]> {
    return this.http
      .get("/byproduct-kinds/", { params: { include_hidden: true } })
      .then((r) => r.data);
  }

  create(name: string): Promise<ByproductKind> {
    return this.http.post("/byproduct-kinds/", { name }).then((r) => r.data);
  }

  update(id: string, body: { name?: string; is_active?: boolean }): Promise<ByproductKind> {
    return this.http.patch(`/byproduct-kinds/${id}`, body).then((r) => r.data);
  }
}

export const byproductKindService = new ByproductKindService();
