#!/usr/bin/env bash
# One-time setup: create a service account for GitHub Actions deploys and
# print the JSON key + the GitHub secret name you need to add.
#
# Usage:
#   ./deploy/setup_github_actions.sh
# Re-runnable: existing service account / bindings are left alone, only the
# JSON key is freshly issued each run.
#
# Required: gcloud auth as a project owner on your-gcp-project.

set -euo pipefail

PROJECT="${GCP_PROJECT:-your-gcp-project}"
SA_NAME="${SA_NAME:-github-deployer}"
SA_EMAIL="$SA_NAME@$PROJECT.iam.gserviceaccount.com"
KEY_OUT="${KEY_OUT:-./github-deployer-key.json}"

echo "==> Project:  $PROJECT"
echo "==> SA:       $SA_EMAIL"

# 1. Service account
if ! gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SA_NAME" \
    --project="$PROJECT" \
    --display-name="GitHub Actions deployer for dripbox"
fi

# 2. Roles. Need:
#  - compute.instanceAdmin.v1  -> describe/scp/ssh to VM
#  - compute.osAdminLogin      -> sudo on the VM via OS Login (deploy.sh runs sudo bash setup_vm.sh)
#  - iam.serviceAccountUser    -> impersonate the VM's default SA during scp/ssh
echo "==> Granting IAM roles"
for role in roles/compute.instanceAdmin.v1 roles/compute.osAdminLogin roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:$SA_EMAIL" \
    --role="$role" \
    --condition=None \
    --quiet >/dev/null
  echo "    $role"
done

# 3. Enable OS Login at the project level so the SA can SSH as a managed user.
echo "==> Enabling OS Login on project"
gcloud compute project-info add-metadata \
  --project="$PROJECT" \
  --metadata=enable-oslogin=TRUE >/dev/null

# 4. Fresh JSON key
echo "==> Issuing JSON key -> $KEY_OUT"
rm -f "$KEY_OUT"
gcloud iam service-accounts keys create "$KEY_OUT" \
  --iam-account="$SA_EMAIL" \
  --project="$PROJECT"

echo
echo "============================================================"
echo " DONE. Next steps (GitHub side, manual):"
echo "------------------------------------------------------------"
echo " 1. Open the repo on GitHub -> Settings -> Secrets and"
echo "    variables -> Actions -> New repository secret."
echo
echo " 2. Name:   GCP_SA_KEY"
echo "    Value:  (paste the full contents of $KEY_OUT)"
echo
echo " 3. Push to main (or run 'Deploy to GCP VM' from the Actions"
echo "    tab) to verify."
echo
echo " 4. After verifying, DELETE $KEY_OUT from your laptop."
echo "============================================================"
