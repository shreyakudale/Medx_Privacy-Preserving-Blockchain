import { useRef } from "react";
import { useSession, useAction, Button, Panel, useToast } from "../components/ui.jsx";
import { hasLocalKey, localPublicKeyString, generateKeyPair, exportKeyBackup, importKeyBackup } from "../lib/crypto.js";

/**
 * Makes sure this browser holds the private key matching the public key
 * published on-chain, and offers backup / restore.
 */
export default function KeyGuard({ children, onChanged }) {
  const { address, participant, exchange } = useSession();
  const toast = useToast();
  const fileRef = useRef(null);
  const onChainKey = participant.encryptionPublicKey;
  const local = hasLocalKey(address) ? localPublicKeyString(address) : null;

  const [publish, publishing] = useAction(async () => {
    const pub = local || (await generateKeyPair(address));
    await (await exchange.updateEncryptionKey(pub)).wait();
    await onChanged();
  }, "Encryption key published.");

  const [replace, replacing] = useAction(async () => {
    if (!confirm("A new key can't open records that were shared with your old key. Continue?")) return;
    const pub = await generateKeyPair(address);
    await (await exchange.updateEncryptionKey(pub)).wait();
    await onChanged();
  }, "New encryption key published.");

  const restore = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      importKeyBackup(address, await f.text());
      toast("Key restored.");
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
  };

  const restoreInput = <input ref={fileRef} type="file" accept="application/json" hidden onChange={restore} />;

  if (!onChainKey) {
    return (
      <Panel title="Publish your encryption key">
        <p>Patients need your public key before they can share records with you. It's created in this browser and published on-chain.</p>
        <Button busy={publishing} onClick={publish}>Create and publish key</Button>
      </Panel>
    );
  }

  if (!local) {
    return (
      <Panel title="Your decryption key isn't on this device">
        <p>Restore your key backup to open records. If you've lost it, you can create a new key, but records shared with the old key will need to be shared again.</p>
        <div className="row">
          <Button onClick={() => fileRef.current?.click()}>Restore key backup</Button>
          <Button variant="quiet" busy={replacing} onClick={replace}>Create a new key</Button>
        </div>
        {restoreInput}
      </Panel>
    );
  }

  if (local !== onChainKey) {
    return (
      <Panel title="This device has a different key">
        <p>The key in this browser doesn't match the one published on-chain. Restore the matching backup, or publish this device's key.</p>
        <div className="row">
          <Button onClick={() => fileRef.current?.click()}>Restore key backup</Button>
          <Button variant="quiet" busy={publishing} onClick={publish}>Publish this device's key</Button>
        </div>
        {restoreInput}
      </Panel>
    );
  }

  return (
    <>
      <div className="keybar">
        <span>Your decryption key is on this device only.</span>
        <button className="link" onClick={backup}>Download key backup</button>
      </div>
      {children}
    </>
  );
}
