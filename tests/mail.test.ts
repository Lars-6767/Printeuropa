import { describe, expect, it } from "vitest";
import { graphMessage, graphToken, mailProvider } from "@/lib/mail-transport";

describe("Microsoft 365-koppeling", () => {
  it("kiest Microsoft wanneer de app-registratie is ingevuld", () => {
    expect(mailProvider({ MS_TENANT_ID: "t", MS_CLIENT_ID: "c", MS_CLIENT_SECRET: "s", MAIL_SENDER: "noreply@bereyl.com" } as any)).toBe("microsoft");
    expect(mailProvider({ SMTP_HOST: "x" } as any)).toBe("smtp");
    expect(mailProvider({} as any)).toBeNull();
  });

  it("bouwt een Graph sendMail-bericht met bijlage", () => {
    const m = graphMessage({ from: "Bereyl <noreply@bereyl.com>", to: "klant@test.nl", cc: "kopie@bereyl.com", replyTo: "info@bereyl.com", subject: "Factuur", html: "<p>x</p>", messageKey: "k1", attachments: [{ filename: "f.pdf", content: Buffer.from("%PDF"), contentType: "application/pdf" }] });
    expect(m.message.toRecipients).toEqual([{ emailAddress: { address: "klant@test.nl" } }]);
    expect(m.message.ccRecipients[0].emailAddress.address).toBe("kopie@bereyl.com");
    expect(m.message.body).toEqual({ contentType: "HTML", content: "<p>x</p>" });
    expect(m.message.attachments[0]).toMatchObject({ "@odata.type": "#microsoft.graph.fileAttachment", name: "f.pdf", contentBytes: Buffer.from("%PDF").toString("base64") });
    expect(m.saveToSentItems).toBe(true);
  });

  it("vraagt een token aan met client credentials", async () => {
    let seen: { url: string; body: string } | null = null;
    const fake = (async (url: string, init: any) => {
      seen = { url, body: String(init.body) };
      return new Response(JSON.stringify({ access_token: "abc", expires_in: 3600 }), { status: 200 });
    }) as any;
    const t = await graphToken({ MS_TENANT_ID: "tenant-1", MS_CLIENT_ID: "client-1", MS_CLIENT_SECRET: "geheim" } as any, fake);
    expect(t).toBe("abc");
    expect(seen!.url).toBe("https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token");
    expect(seen!.body).toContain("grant_type=client_credentials");
    expect(seen!.body).toContain("scope=https%3A%2F%2Fgraph.microsoft.com%2F.default");
  });
});
