import { loadEnv } from "./env";
import { getDb, withBootstrap } from "../src/server/db/client";
import { recordAudit } from "../src/server/audit/audit";
import { hashPassword } from "../src/server/security/passwords";
import { generatePassword } from "../src/server/security/tokens";

loadEnv();

const DEV_ONLY_PASSWORD = process.env.SEED_DEMO_PASSWORD || "";

async function main(): Promise<void> {
  const db = getDb();
  await db`select 1`;

  const summary = await withBootstrap(async (tx) => {
    const roles = await tx<{ code: string; id: string }[]>`select code, id from roles`;
    const roleId = new Map(roles.map((role) => [role.code, role.id]));

    // 1. Platform super admin ---------------------------------------
    const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "admin@examforge.local").toLowerCase();
    const adminPassword = process.env.SEED_ADMIN_PASSWORD?.trim() || generatePassword();

    let [platformAdmin] = await tx`
      select id from users where lower(email) = ${adminEmail} limit 1
    `;
    let platformAdminCreated = false;
    if (!platformAdmin) {
      const [user] = await tx`
        insert into users (
          auth_provider, external_subject, email, display_name,
          password_hash, status
        ) values (
          'local', ${adminEmail}, ${adminEmail}, 'Platform Super Admin',
          ${await hashPassword(adminPassword)}, 'active'
        )
        returning id
      `;
      platformAdmin = user;
      platformAdminCreated = true;
    }
    const superRole = roleId.get("platform_super_admin");
    if (superRole) {
      await tx`
        insert into user_roles (tenant_id, user_id, role_id, granted_by)
        values (null, ${platformAdmin.id}, ${superRole}, null)
        on conflict (tenant_id, user_id, role_id) do nothing
      `;
    }

    // 2. Demonstration examination configuration --------------------
    // These records establish the supported examination types without
    // claiming to contain official curriculum content. They remain draft
    // until an administrator verifies and activates authoritative data.
    for (const exam of [
      { code: "UTME", name: "UTME (Demonstration configuration)" },
      { code: "WAEC", name: "WAEC (Demonstration configuration)" },
    ]) {
      const [examType] = await tx`
        insert into exam_types (code, name, description, status, created_by)
        values (
          ${exam.code}, ${exam.name},
          'Demonstration configuration only; not official curriculum data.',
          'draft', ${platformAdmin.id}
        )
        on conflict (code) do update set name = excluded.name
        returning id
      `;
      await tx`
        insert into exam_sessions (
          exam_type_id, code, name, status, created_by
        ) values (
          ${examType.id}, 'DEMO-2026', 'Demonstration session 2026',
          'draft', ${platformAdmin.id}
        )
        on conflict (exam_type_id, code) do nothing
      `;
    }

    // 3. Demo centre --------------------------------------------------
    const tenantSlug = (process.env.SEED_TENANT_SLUG ?? "demo-centre").toLowerCase();
    const tenantName = process.env.SEED_TENANT_NAME ?? "Demo Tutorial Centre";

    let [tenant] = await tx`
      select id, slug, name from tenants where slug = ${tenantSlug} limit 1
    `;
    if (!tenant) {
      [tenant] = await tx`
        insert into tenants (name, slug, created_by)
        values (${tenantName}, ${tenantSlug}, ${platformAdmin.id})
        returning id, slug, name
      `;
      await tx`
        insert into audit_logs (
          actor_user_id, action, resource_type, resource_id, details
        ) values (
          ${platformAdmin.id}, 'tenant.created', 'tenant', ${tenant.id},
          ${tx.json({ slug: tenantSlug })}
        )
      `;
    }

    // 4. Demo payment plan -------------------------------------------
    // Demonstration configuration only. The amount is deliberately small and
    // the plan is inactive-by-default so it can never be charged accidentally
    // in a real deployment. Explicitly activate it to exercise the flow.
    await tx`
      insert into payment_plans (
        tenant_id, code, name, description, plan_type, amount_minor,
        currency, entitlement_duration_days, status, created_by
      ) values (
        ${tenant.id}, 'DEMO-ONE-TIME', 'Demo enrolment fee',
        'Demonstration payment plan; activate manually for local testing.',
        'one_time', 500000, 'NGN', 365, 'draft', ${platformAdmin.id}
      )
      on conflict (tenant_id, code) do nothing
    `;

    // 5. Demo centre accounts -----------------------------------------
    const demoPassword = DEV_ONLY_PASSWORD || generatePassword();
    const demoUsers = [
      {
        email: "centre-admin@demo-centre.local",
        displayName: "Centre Admin",
        role: "centre_admin",
        profile: null,
        humanCode: "C-ADMIN-001",
      },
      {
        email: "teacher@demo-centre.local",
        displayName: "Demo Teacher",
        role: "teacher",
        profile: "teacher",
        humanCode: "T-DEMO-001",
      },
      {
        email: "student@demo-centre.local",
        displayName: "Demo Student",
        role: "student",
        profile: "student",
        humanCode: "S-DEMO-001",
      },
    ];

    const createdEmails: string[] = [];
    for (const demo of demoUsers) {
      const email = demo.email.toLowerCase();
      const [existing] = await tx`
        select id from users where lower(email) = ${email} limit 1
      `;
      if (existing) continue;

      const [user] = await tx`
        insert into users (
          auth_provider, external_subject, email, display_name,
          password_hash, status
        ) values (
          'local', ${email}, ${email}, ${demo.displayName},
          ${await hashPassword(demoPassword)}, 'active'
        )
        returning id
      `;
      createdEmails.push(email);

      await tx`
        insert into tenant_memberships (
          tenant_id, user_id, membership_status, human_code
        ) values (
          ${tenant.id}, ${user.id}, 'active', ${demo.humanCode}
        )
      `;
      const demoRole = roleId.get(demo.role);
      if (demoRole) {
        await tx`
          insert into user_roles (tenant_id, user_id, role_id, granted_by)
          values (${tenant.id}, ${user.id}, ${demoRole}, ${platformAdmin.id})
        `;
      }
      if (demo.profile === "student") {
        await tx`
          insert into student_profiles (tenant_id, user_id, admission_no, status, created_by)
          values (${tenant.id}, ${user.id}, ${demo.humanCode}, 'active', ${platformAdmin.id})
        `;
      }
      if (demo.profile === "teacher") {
        await tx`
          insert into teacher_profiles (tenant_id, user_id, staff_no, status, created_by)
          values (${tenant.id}, ${user.id}, ${demo.humanCode}, 'active', ${platformAdmin.id})
        `;
      }
      await tx`
        insert into audit_logs (
          tenant_id, actor_user_id, action, resource_type, details
        ) values (
          ${tenant.id}, ${platformAdmin.id}, 'user.account_created', 'user',
          ${tx.json({ email, role: demo.role })}
        )
      `;
    }

    return {
      adminEmail,
      adminPassword,
      platformAdminCreated,
      tenantSlug,
      tenantName,
      demoPassword,
      createdEmails,
    };
  });
  await recordAudit({
    action: "user.account_created",
    actorUserId: null,
    details: { source: "seed-script" },
  });

  console.log("Seed complete.\n");
  console.log(`Platform admin  : ${summary.adminEmail}`);
  console.log(
    summary.platformAdminCreated
      ? `  password      : ${summary.adminPassword}`
      : "  password      : (unchanged — set SEED_ADMIN_PASSWORD to rotate)",
  );
  console.log(`Demo centre     : ${summary.tenantName} (${summary.tenantSlug})`);
  console.log(`Demo password   : ${summary.demoPassword}`);
  for (const email of summary.createdEmails) {
    console.log(`  new account   : ${email}`);
  }
  console.log(
    "\nDemo accounts share the demo password above. Platform admin logs in at /login.",
  );
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});