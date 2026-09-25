-- Phase 2: replace the generic support role with an explicit content admin.
-- Existing tenant membership and user-role structures remain unchanged.

insert into roles (code, name, description, scope, is_system) values
  ('content_admin', 'Content Admin', 'Manages centre learning content and assessments', 'tenant', true)
on conflict (code) do nothing;

insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r
cross join permissions p
where r.code = 'content_admin'
  and p.code in (
    'tenant.content.manage', 'tenant.cbt.manage', 'tenant.reports.view',
    'self.profile.manage'
  )
on conflict do nothing;

insert into user_roles (tenant_id, user_id, role_id, granted_by)
select ur.tenant_id, ur.user_id, content_role.id, ur.granted_by
from user_roles ur
join roles support_role on support_role.id = ur.role_id
join roles content_role on content_role.code = 'content_admin'
where support_role.code = 'support'
on conflict do nothing;

delete from user_roles
where role_id in (select id from roles where code = 'support');

delete from role_permissions
where role_id in (select id from roles where code = 'support');

delete from roles where code = 'support';