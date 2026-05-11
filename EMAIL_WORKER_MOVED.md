# Email worker — moved

The Cloudflare email worker that used to live at `cloudflare/email-worker/` in
this repo is now its own repository:

**https://github.com/expresscharge/email-worker**

History is preserved (the directory was extracted via
`git filter-repo
--subdirectory-filter`, so each commit that touched it carries
over). Develop the worker in the standalone repo.
