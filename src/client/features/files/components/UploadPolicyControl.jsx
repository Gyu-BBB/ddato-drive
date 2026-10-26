import { Settings2 } from 'lucide-react';
import './uploadPolicy.css';

export function UploadPolicyControl({ value, onChange }) {
  return <details className="upload-policy">
    <summary title="업로드 설정" aria-label="업로드 설정"><Settings2 size={17} /></summary>
    <fieldset>
      <legend>같은 이름의 파일</legend>
      {[['keep', '둘 다 유지'], ['skip', '건너뛰기'], ['replace', '교체 · 기존 파일은 휴지통으로']].map(([id, label]) =>
        <label key={id}><input type="radio" name="upload-conflict-policy" checked={value === id} onChange={() => onChange(id)} />{label}</label>)}
    </fieldset>
  </details>;
}
