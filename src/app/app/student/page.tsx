import { getAppContext, requireRole } from "@/server/auth/app-context";
import { checkEntitlement } from "@/server/payments/entitlements";
import { listStudentPayments } from "@/server/payments/payments";
import { Badge, Card, EmptyState } from "../../components/ui";
import PaymentSessionLauncher from "./payment-session-launcher";

export default async function StudentWorkspace() {
  const { context } = await getAppContext();
  requireRole(context, ["student"]);
  if (!context) return null;

  // Server-side access-control service. The dashboard is only unlocked by an
  // ACTIVE entitlement derived from a verified payment; client state, query
  // parameters, and student-reported status are never consulted.
  const access = await checkEntitlement(context);
  const payments = await listStudentPayments(context);

  if (!access.ok) {
    const latest = payments[0];
    return (
      <div className="page-stack">
        <div className="page-heading">
          <div>
            <span className="eyebrow">Student workspace</span>
            <h2>Complete your enrolment</h2>
            <p>Your workspace unlocks after a verified payment for your registration.</p>
          </div>
          <Badge tone="amber">Payment required</Badge>
        </div>

        <Card>
          <div className="section-heading">
            <div>
              <span className="eyebrow">Enrolment payment</span>
              <h3>Verify your enrolment</h3>
            </div>
          </div>
          <p className="muted">
            {latest
              ? <>Your registration payment is currently <strong>{latest.status}</strong>. Starting a payment session sends you to the secure payment page; access is granted only after the payment provider confirms and our server verifies the transaction.</>
              : <>Complete your registration first, then return here to start your payment.</>}
          </p>
          {latest ? <PaymentSessionLauncher /> : null}
        </Card>

        <Card>
          <EmptyState title="Learning is locked">
            Your learning path remains locked until a verified payment activates your entitlement.
          </EmptyState>
        </Card>
      </div>
    );
  }

  const entitlement = access.value;
  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Student workspace</span>
          <h2>Your learning path</h2>
          <p>Your access is active. Your assigned examinations will be published here.</p>
        </div>
        <Badge tone="green">Access active</Badge>
      </div>

      <Card>
        <div className="section-heading">
          <div>
            <span className="eyebrow">Entitlement</span>
            <h3>Active enrolment</h3>
          </div>
          <Badge tone="blue">{entitlement.status}</Badge>
        </div>
        <p className="muted">
          {entitlement.expiresAt
            ? <>Access valid until {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(entitlement.expiresAt)}.</>
            : <>Access is active with no expiry configured by your plan.</>}
        </p>
      </Card>

      <Card>
        <EmptyState title="No examinations published yet">
          Your centre will publish examination resources and practice materials to this workspace.
        </EmptyState>
      </Card>
    </div>
  );
}
