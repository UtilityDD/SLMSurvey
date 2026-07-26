-- Expose survey to PostgREST (may require Dashboard if privilege denied)
alter role authenticator set pgrst.db_schemas = 'public, storage, graphql_public, survey';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
