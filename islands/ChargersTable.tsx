import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";

interface ChargeBox {
  chargeBoxId: string;
  chargeBoxPk: number;
}

interface Props {
  chargeBoxes: ChargeBox[];
}

export default function ChargersTable({ chargeBoxes }: Props) {
  if (chargeBoxes.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No charge boxes found.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Charge Box ID</TableHead>
          <TableHead className="text-right">PK</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {chargeBoxes.map((cb) => (
          <TableRow key={cb.chargeBoxPk}>
            <TableCell className="font-medium">{cb.chargeBoxId}</TableCell>
            <TableCell className="text-right text-muted-foreground">
              {cb.chargeBoxPk}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
