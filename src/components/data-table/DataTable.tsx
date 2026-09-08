import { useEffect, useRef, type ReactNode } from 'react'

import './data-table.css'

export interface DataTableColumn<TRow> {
  readonly id: string
  readonly label: string
  readonly render: (row: TRow) => ReactNode
  readonly sortField?: string
}

export interface DataTableSort {
  readonly field: string
  readonly direction: 'ascending' | 'descending'
}

export interface DataTableSelection<TRow> {
  readonly getLabel: (row: TRow) => string
  readonly isRowSelectable?: (row: TRow) => boolean
  readonly isSelected: (row: TRow) => boolean
  readonly onToggleRow: (row: TRow, selected: boolean) => void
  readonly onToggleAllRows: (rows: readonly TRow[], selected: boolean) => void
}

interface DataTableProps<TRow> {
  readonly caption: string
  readonly columns: readonly DataTableColumn<TRow>[]
  readonly getRowKey: (row: TRow) => string
  readonly rows: readonly TRow[]
  readonly sort?: DataTableSort
  readonly onSort?: (field: string) => void
  readonly selection?: DataTableSelection<TRow>
  readonly density?: 'comfortable' | 'compact'
}

export function DataTable<TRow>({
  caption,
  columns,
  getRowKey,
  rows,
  sort,
  onSort,
  selection,
  density = 'comfortable',
}: DataTableProps<TRow>) {
  const selectableRows = selection
    ? rows.filter((row) => selection.isRowSelectable?.(row) !== false)
    : []
  const selectedRowCount = selection
    ? selectableRows.filter((row) => selection.isSelected(row)).length
    : 0
  const allRowsSelected =
    selectableRows.length > 0 && selectedRowCount === selectableRows.length
  const someRowsSelected = selectedRowCount > 0 && !allRowsSelected

  return (
    <div
      className="data-table-scroll"
      role="region"
      aria-label={caption}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users need focus to scroll this region.
      tabIndex={0}
    >
      <table className={`data-table data-table--${density}`}>
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {selection ? (
              <th className="data-table__selection" scope="col">
                <IndeterminateCheckbox
                  aria-label="Select all rows on this page"
                  checked={allRowsSelected}
                  disabled={selectableRows.length === 0}
                  indeterminate={someRowsSelected}
                  onChange={(selected) => {
                    selection.onToggleAllRows(selectableRows, selected)
                  }}
                />
              </th>
            ) : null}
            {columns.map((column) => {
              const sortField = column.sortField
              const isSorted = sort?.field === column.sortField
              const direction = isSorted ? sort?.direction : undefined

              return (
                <th key={column.id} scope="col" aria-sort={direction}>
                  {sortField && onSort ? (
                    <button
                      className="data-table__sort"
                      type="button"
                      onClick={() => {
                        onSort(sortField)
                      }}
                    >
                      {column.label}
                      <span aria-hidden="true">
                        {direction
                          ? direction === 'ascending'
                            ? ' ↑'
                            : ' ↓'
                          : ' ↕'}
                      </span>
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={getRowKey(row)}>
              {selection ? (
                <td className="data-table__selection">
                  <IndeterminateCheckbox
                    aria-label={selection.getLabel(row)}
                    checked={selection.isSelected(row)}
                    disabled={selection.isRowSelectable?.(row) === false}
                    indeterminate={false}
                    onChange={(selected) => {
                      selection.onToggleRow(row, selected)
                    }}
                  />
                </td>
              ) : null}
              {columns.map((column) => (
                <td key={column.id}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface IndeterminateCheckboxProps {
  readonly 'aria-label': string
  readonly checked: boolean
  readonly disabled?: boolean
  readonly indeterminate: boolean
  readonly onChange: (checked: boolean) => void
}

function IndeterminateCheckbox({
  'aria-label': ariaLabel,
  checked,
  disabled = false,
  indeterminate,
  onChange,
}: IndeterminateCheckboxProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = indeterminate
    }
  }, [indeterminate])

  return (
    <input
      ref={inputRef}
      aria-label={ariaLabel}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => {
        onChange(event.currentTarget.checked)
      }}
    />
  )
}
