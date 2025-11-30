import { useMemo } from 'react';
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import { ChartSkeleton } from '@/components/ui/skeleton';

interface ConcurrentData {
  hour: string;
  maxConcurrent: number;
}

interface ConcurrentChartProps {
  data: ConcurrentData[] | undefined;
  isLoading?: boolean;
  height?: number;
}

export function ConcurrentChart({ data, isLoading, height = 250 }: ConcurrentChartProps) {
  const options = useMemo<Highcharts.Options>(() => {
    if (!data || data.length === 0) {
      return {};
    }

    // Find the peak for highlighting
    const maxValue = Math.max(...data.map((d) => d.maxConcurrent));

    return {
      chart: {
        type: 'area',
        height,
        backgroundColor: 'transparent',
        style: {
          fontFamily: 'inherit',
        },
      },
      title: {
        text: undefined,
      },
      credits: {
        enabled: false,
      },
      legend: {
        enabled: false,
      },
      xAxis: {
        type: 'datetime',
        categories: data.map((d) => d.hour),
        labels: {
          style: {
            color: 'hsl(var(--muted-foreground))',
          },
          formatter: function () {
            const date = new Date(this.value as string);
            return `${date.getMonth() + 1}/${date.getDate()}`;
          },
          step: Math.ceil(data.length / 10), // Show ~10 labels
        },
        lineColor: 'hsl(var(--border))',
        tickColor: 'hsl(var(--border))',
      },
      yAxis: {
        title: {
          text: undefined,
        },
        labels: {
          style: {
            color: 'hsl(var(--muted-foreground))',
          },
        },
        gridLineColor: 'hsl(var(--border))',
        min: 0,
        plotLines: [
          {
            value: maxValue,
            color: 'hsl(var(--destructive))',
            dashStyle: 'Dash',
            width: 1,
            label: {
              text: `Peak: ${maxValue}`,
              align: 'right',
              style: {
                color: 'hsl(var(--destructive))',
                fontSize: '10px',
              },
            },
          },
        ],
      },
      plotOptions: {
        area: {
          fillColor: {
            linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
            stops: [
              [0, 'hsl(var(--chart-3) / 0.3)'],
              [1, 'hsl(var(--chart-3) / 0.05)'],
            ],
          },
          marker: {
            enabled: false,
            states: {
              hover: {
                enabled: true,
                radius: 4,
              },
            },
          },
          lineWidth: 2,
          lineColor: 'hsl(var(--chart-3))',
          states: {
            hover: {
              lineWidth: 2,
            },
          },
          threshold: null,
        },
      },
      tooltip: {
        backgroundColor: 'hsl(var(--popover))',
        borderColor: 'hsl(var(--border))',
        style: {
          color: 'hsl(var(--popover-foreground))',
        },
        formatter: function () {
          const date = new Date(String(this.x));
          return `<b>${date.toLocaleDateString()} ${date.getHours()}:00</b><br/>Concurrent: ${this.y}`;
        },
      },
      series: [
        {
          type: 'area',
          name: 'Concurrent Streams',
          data: data.map((d) => d.maxConcurrent),
        },
      ],
    };
  }, [data, height]);

  if (isLoading) {
    return <ChartSkeleton height={height} />;
  }

  if (!data || data.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed text-muted-foreground"
        style={{ height }}
      >
        No concurrent stream data available
      </div>
    );
  }

  return <HighchartsReact highcharts={Highcharts} options={options} />;
}
