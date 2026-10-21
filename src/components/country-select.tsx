import { COUNTRIES } from "@/lib/countries";
import { Select } from "./ui/primitives";

const COMMON = ["ZA", "ZW", "AU", "BW", "MZ", "MW", "ZM", "NG", "GB", "NZ", "LS", "SZ", "NA", "CD", "IN", "PK"];

/** Country picker with the countries the firms see most often listed first. */
export function CountrySelect({ placeholder = "Not recorded", ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { placeholder?: string }) {
  const common = COMMON.map((c) => COUNTRIES.find(([code]) => code === c)!).filter(Boolean);
  return (
    <Select {...props}>
      <option value="">{placeholder}</option>
      <optgroup label="Frequent">
        {common.map(([code, name]) => (
          <option key={`c-${code}`} value={code}>{name}</option>
        ))}
      </optgroup>
      <optgroup label="All countries">
        {COUNTRIES.map(([code, name]) => (
          <option key={code} value={code}>{name}</option>
        ))}
      </optgroup>
    </Select>
  );
}
