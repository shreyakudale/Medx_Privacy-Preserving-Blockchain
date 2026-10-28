import { useRef } from "react";
import {
  useSession,
  useAction,
  useConfirm,
  CANCELLED,
  Button,
  Panel,
  useToast,
  Pill,
} from "../components/ui.jsx";
import {
  hasLocalKey,
  localPublicKeyString,
  generateKeyPair,
  exportKeyBackup,
  importKeyBackup,
} from "../lib/crypto.js";

/**
 * Makes sure this browser holds the private key matching the public key
 * published on-chain, and offers backup / restore.
 */
export default function KeyGuard({ children, onChanged }) {
  const { address, participant, exchange } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const fileRef = useRef(null);
  const onChainKey = participant.encryptionPublicKey;
  const local = hasLocalKey(address) ? localPublicKeyString(address) : null;

  const [publish, publishing] = useAction(async () => {
    const pub = local || (await generateKeyPair(address));
    await (await exchange.updateEncryptionKey(pub)).wait();
    await onChanged();
  }, "Encryption key published to blockchain.");

  const [replace, replacing] = useAction(async () => {
    if (
      !(await confirm({
        title: "Generate New Device Keypair?",
        body: "A new key cannot open records that were encrypted with your previous key. Those records must be re-shared with you.",
        confirmLabel: "Generate New Key",
        danger: true,
      }))
    )
      return CANCELLED;
    const pub = await generateKeyPair(address);
    await (await exchange.updateEncryptionKey(pub)).wait();
    await onChanged();
  }, "New encryption key registered on-chain.");

  const restore = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      importKeyBackup(address, await f.text());
      toast("Decryption key backup successfully restored!", "ok");
      await onChanged();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const backup = () => {
    const blob = new Blob([exportKeyBackup(address)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `medzk-key-${address.slice(2, 8)}.json`;
    a.click();
    toast("Key backup downloaded. Keep it in a secure location.", "ok");
  };

  const restoreInput = (
    <input ref={fileRef} type="file" accept="application/json" hidden onChange={restore} />
  );

  if (!onChainKey) {
    return (
      <Panel
        title="Publish Your Public Encryption Key"
        subtitle="Required on-chain so patients and doctors can encrypt AES keys specifically for you"
        icon="🔑"
      >
        <p className="panel-sub">
          Patients need your public key before they can share records with you. It is generated in
          this browser and anchored on Ethereum.
        </p>
        <div className="panel-actions-row">
          <Button busy={publishing} onClick={publish} variant="primary" icon="🔐">
            Create & Publish Key to Blockchain
          </Button>
        </div>
      </Panel>
    );
  }

  if (!local) {
    return (
      <Panel
        title="Decryption Key Missing On This Device"
        subtitle="Your private key is stored in browser localStorage and was not found here"
        icon="⚠️"
      >
        <div className="alert-banner alert-banner-danger">
          Restore your JSON key backup to decrypt your records. If you lost your backup, you can
          generate a new key, but existing records must be shared again.
        </div>
        <div className="panel-actions-row">
          <Button onClick={() => fileRef.current?.click()} variant="primary" icon="📥">
            Restore Key Backup File
          </Button>
          <Button variant="outline" busy={replacing} onClick={replace}>
            Generate New Keypair
          </Button>
        </div>
        {restoreInput}
      </Panel>
    );
  }

  if (local !== onChainKey) {
    return (
      <Panel
        title="Key Mismatch Detected"
        subtitle="The private key on this device does not match the public key registered on-chain"
        icon="⚠️"
      >
        <p className="panel-sub">
          Restore the matching key backup or publish this device's key to Ethereum.
        </p>
        <div className="panel-actions-row">
          <Button onClick={() => fileRef.current?.click()} variant="primary" icon="📥">
            Restore Matching Key Backup
          </Button>
          <Button variant="outline" busy={publishing} onClick={publish}>
            Publish Device Key to Chain
          </Button>
        </div>
        {restoreInput}
      </Panel>
    );
  }

  return (
    <>
      <div className="key-security-strip">
        <div className="key-strip-left">
          <span className="key-shield-icon">🛡️</span>
          <span className="key-strip-text">
            Client-Side Cryptography Active: Private RSA key resides exclusively in this browser.
          </span>
          <Pill tone="ok" icon="●">Hardware Protected</Pill>
        </div>
        <button className="btn-key-backup" onClick={backup}>
          📥 Download Key Backup
        </button>
      </div>
      {children}
    </>
  );
}
