# Security and privacy boundaries

- This is a **local, single-user application**. The server binds only to `127.0.0.1`; do not put it on a public network or use it as a multi-tenant service.
- The browser API checks Host/Origin, uses an HttpOnly/SameSite cookie and a per-process CSRF token. The runtime bridge has a separate, per-task secret and a fixed project scope.
- DSH is pinned to a preview release and has not been independently security-audited by this project. Its default terminal/file mutation tools are disabled. A monotonic tool guard permits only this product's media tools and project-scoped image reads. This is **not an OS sandbox** and does not defend against vulnerabilities in the runtime, Python libraries or media decoders.
- The installed workbench is trusted local code. Only its documented, project-scoped operations are exposed. Arbitrary shell commands, plugin installation, other projects, external publication, and arbitrary filesystem access are not model capabilities.
- The model receives task text, selected materials, required method documents and relevant conversation history. Configure a provider you trust and obtain permission to use third-party material. DSH's default session-log and package-inventory upload extensions are explicitly disabled; ordinary model input still goes to your provider.
- Saved API keys are encrypted locally with AES-GCM. The local encryption key is stored in the same private application directory. This protects against accidental plaintext exposure, **not against someone who controls the same OS account or can copy the entire data directory**. Use OS account/file permissions and disk encryption as needed.
- `.local/`, API credentials, raw sessions, workbench projects, uploads, private verification data and the supplied design archive are excluded from Git and release packaging. Do not upload a project data directory when reporting a bug.
- File downloads resolve real paths within the selected project; symlink/path traversal and active HTML downloads are restricted. Uploads and outputs are untrusted data, not instructions or authorizations.
- Stopping a Bot closes its owned DSH process. It does not claim to cancel an independent workbench render. Saved history is preserved. A process restart marks unfinished app tasks as interrupted, not successful.
- Technical validation is not fact checking, rights clearance, human listening, aesthetic acceptance or evidence of social-platform publication.

If you find a vulnerability, contact the repository owner privately through an available GitHub security/reporting channel. Do not post credentials, private material, logs containing personal data, or exploit details in a public issue.
