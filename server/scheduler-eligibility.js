export function eligible(employee, role, airline, international) {
  if (role === 'lead') {
    if (!['lead', 'supervisor'].includes(employee.primary_role)) return false;
  } else if (!employee.eligible_roles.includes(role)) return false;
  if (international && !employee.customs_seal) return false;
  const qualification = employee.qualifications.find(item => item.airline === airline);
  if (role === 'lead' && !qualification?.can_lead) return false;
  return true;
}
